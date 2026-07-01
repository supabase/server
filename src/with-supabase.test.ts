import { beforeEach, describe, expect, it, vi } from 'vitest'
import { defineMiddleware } from '@supabase/web-middleware'

import { _resetAllowDeprecationWarned } from './core/utils/deprecation.js'
import { withSupabase } from './with-supabase.js'

const baseEnv = {
  url: 'https://test.supabase.co',
  publishableKeys: { default: 'sb_publishable_xyz' },
  secretKeys: { default: 'sb_secret_xyz' },
  jwks: null,
}

describe('withSupabase', () => {
  it('handles OPTIONS preflight with CORS', async () => {
    const handler = withSupabase({ auth: 'none', env: baseEnv }, async () =>
      Response.json({ ok: true }),
    )

    const req = new Request('http://localhost', { method: 'OPTIONS' })
    const res = await handler(req)
    expect(res.status).toBe(204)
    expect(res.headers.get('Access-Control-Allow-Origin')).toBe('*')
  })

  it('skips OPTIONS handling when cors is false', async () => {
    const handler = withSupabase(
      { auth: 'none', env: baseEnv, cors: false },
      async () => Response.json({ ok: true }),
    )

    const req = new Request('http://localhost', { method: 'OPTIONS' })
    const res = await handler(req)
    // When CORS disabled, OPTIONS goes through normal flow
    expect(res.status).toBe(200)
  })

  it('calls handler with context on successful auth', async () => {
    const handler = withSupabase(
      { auth: 'none', env: baseEnv },
      async (_req, ctx) => {
        return Response.json({
          authMode: ctx.authMode,
          hasSupabase: !!ctx.supabase,
          hasAdmin: !!ctx.supabaseAdmin,
        })
      },
    )

    const req = new Request('http://localhost')
    const res = await handler(req)
    const body = await res.json()
    expect(body.authMode).toBe('none')
    expect(body.hasSupabase).toBe(true)
    expect(body.hasAdmin).toBe(true)
  })

  it('returns error response on auth failure', async () => {
    const handler = withSupabase({ auth: 'user', env: baseEnv }, async () =>
      Response.json({ ok: true }),
    )

    const req = new Request('http://localhost')
    const res = await handler(req)
    expect(res.status).toBe(401)
    const body = await res.json()
    expect(body.message).toBeDefined()
    expect(body.code).toBeDefined()
  })

  it('adds CORS headers to success response', async () => {
    const handler = withSupabase({ auth: 'none', env: baseEnv }, async () =>
      Response.json({ ok: true }),
    )

    const req = new Request('http://localhost')
    const res = await handler(req)
    expect(res.headers.get('Access-Control-Allow-Origin')).toBe('*')
  })

  it('adds CORS headers to error response', async () => {
    const handler = withSupabase({ auth: 'user', env: baseEnv }, async () =>
      Response.json({ ok: true }),
    )

    const req = new Request('http://localhost')
    const res = await handler(req)
    expect(res.headers.get('Access-Control-Allow-Origin')).toBe('*')
  })

  it('does not add CORS headers when cors is false', async () => {
    const handler = withSupabase(
      { auth: 'none', env: baseEnv, cors: false },
      async () => Response.json({ ok: true }),
    )

    const req = new Request('http://localhost')
    const res = await handler(req)
    expect(res.headers.get('Access-Control-Allow-Origin')).toBeNull()
  })

  describe('plugins', () => {
    it('composes plugins after the Supabase context is established', async () => {
      const withFlag = defineMiddleware<
        'flag',
        void,
        Record<never, never>,
        boolean
      >({
        key: 'flag',
        run: () => async () => ({ flag: true }),
      })

      const handler = withSupabase(
        { auth: 'none', env: baseEnv, plugins: [withFlag()] },
        async (_req, ctx) =>
          Response.json({ authMode: ctx.authMode, flag: ctx.flag }),
      )

      const res = await handler(new Request('http://localhost'))
      const body = await res.json()
      expect(body.authMode).toBe('none')
      expect(body.flag).toBe(true)
    })

    it('plugin receives the Supabase context at runtime', async () => {
      let capturedHasSupabase = false

      const withCapture = defineMiddleware<
        'captured',
        void,
        Record<never, never>,
        true
      >({
        key: 'captured',
        run: () => async (_req, ctx) => {
          capturedHasSupabase = !!(ctx as { supabase?: unknown }).supabase
          return { captured: true as const }
        },
      })

      const handler = withSupabase(
        { auth: 'none', env: baseEnv, plugins: [withCapture()] },
        async () => Response.json({ ok: true }),
      )

      await handler(new Request('http://localhost'))
      expect(capturedHasSupabase).toBe(true)
    })

    it('plugin can short-circuit before the handler', async () => {
      const withBlock = defineMiddleware<
        'blocked',
        void,
        Record<never, never>,
        true
      >({
        key: 'blocked',
        run: () => async () => new Response('blocked', { status: 403 }),
      })

      const innerHandler = vi.fn(async () => Response.json({ ok: true }))

      const handler = withSupabase(
        { auth: 'none', env: baseEnv, plugins: [withBlock()] },
        innerHandler,
      )

      const res = await handler(new Request('http://localhost'))
      expect(res.status).toBe(403)
      expect(innerHandler).not.toHaveBeenCalled()
    })

    it('plugins run in array order (first = outermost, runs first on request)', async () => {
      const order: string[] = []

      const withA = defineMiddleware<'a', void, Record<never, never>, true>({
        key: 'a',
        run: () => async () => {
          order.push('a')
          return { a: true as const }
        },
      })
      const withB = defineMiddleware<'b', void, Record<never, never>, true>({
        key: 'b',
        run: () => async () => {
          order.push('b')
          return { b: true as const }
        },
      })

      const handler = withSupabase(
        { auth: 'none', env: baseEnv, plugins: [withA(), withB()] },
        async (_req, ctx) => Response.json({ a: ctx.a, b: ctx.b }),
      )

      const res = await handler(new Request('http://localhost'))
      expect(order).toEqual(['a', 'b'])
      expect(await res.json()).toEqual({ a: true, b: true })
    })

    it('CORS headers still apply when plugins are present', async () => {
      const withNoop = defineMiddleware<
        'noop',
        void,
        Record<never, never>,
        true
      >({
        key: 'noop',
        run: () => async () => ({ noop: true as const }),
      })

      const handler = withSupabase(
        { auth: 'none', env: baseEnv, plugins: [withNoop()] },
        async () => Response.json({ ok: true }),
      )

      const res = await handler(new Request('http://localhost'))
      expect(res.headers.get('Access-Control-Allow-Origin')).toBe('*')
    })
  })

  describe('allow → auth deprecation', () => {
    beforeEach(() => {
      _resetAllowDeprecationWarned()
    })

    it('still works with the deprecated `allow` option', async () => {
      const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
      const handler = withSupabase(
        { allow: 'none', env: baseEnv },
        async (_req, ctx) => Response.json({ authMode: ctx.authMode }),
      )

      const req = new Request('http://localhost')
      const res = await handler(req)
      expect(res.status).toBe(200)
      const body = await res.json()
      expect(body.authMode).toBe('none')
      expect(warn).toHaveBeenCalled()
      warn.mockRestore()
    })

    it('does not warn when `auth` is used', async () => {
      const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
      const handler = withSupabase({ auth: 'none', env: baseEnv }, async () =>
        Response.json({ ok: true }),
      )
      const req = new Request('http://localhost')
      await handler(req)
      expect(warn).not.toHaveBeenCalled()
      warn.mockRestore()
    })
  })
})
