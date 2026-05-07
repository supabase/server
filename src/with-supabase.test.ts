import { beforeEach, describe, expect, it, vi } from 'vitest'

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
