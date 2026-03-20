import { describe, expect, it } from 'vitest'

import { withSupabase } from './with-supabase.js'

const baseEnv = {
  url: 'https://test.supabase.co',
  publishableKeys: { default: 'pk_test' },
  secretKeys: { default: 'sk_test' },
  jwks: null,
}

describe('withSupabase', () => {
  it('handles OPTIONS preflight with CORS', async () => {
    const handler = withSupabase({ allow: 'always', env: baseEnv }, async () =>
      Response.json({ ok: true }),
    )

    const req = new Request('http://localhost', { method: 'OPTIONS' })
    const res = await handler(req)
    expect(res.status).toBe(204)
    expect(res.headers.get('Access-Control-Allow-Origin')).toBe('*')
  })

  it('skips OPTIONS handling when cors is false', async () => {
    const handler = withSupabase(
      { allow: 'always', env: baseEnv, cors: false },
      async () => Response.json({ ok: true }),
    )

    const req = new Request('http://localhost', { method: 'OPTIONS' })
    const res = await handler(req)
    // When CORS disabled, OPTIONS goes through normal flow
    expect(res.status).toBe(200)
  })

  it('calls handler with context on successful auth', async () => {
    const handler = withSupabase(
      { allow: 'always', env: baseEnv },
      async (_req, ctx) => {
        return Response.json({
          authType: ctx.authType,
          hasSupabase: !!ctx.supabase,
          hasAdmin: !!ctx.supabaseAdmin,
        })
      },
    )

    const req = new Request('http://localhost')
    const res = await handler(req)
    const body = await res.json()
    expect(body.authType).toBe('always')
    expect(body.hasSupabase).toBe(true)
    expect(body.hasAdmin).toBe(true)
  })

  it('returns error response on auth failure', async () => {
    const handler = withSupabase({ allow: 'user', env: baseEnv }, async () =>
      Response.json({ ok: true }),
    )

    const req = new Request('http://localhost')
    const res = await handler(req)
    expect(res.status).toBe(401)
    const body = await res.json()
    expect(body.error).toBeDefined()
    expect(body.code).toBeDefined()
  })

  it('adds CORS headers to success response', async () => {
    const handler = withSupabase({ allow: 'always', env: baseEnv }, async () =>
      Response.json({ ok: true }),
    )

    const req = new Request('http://localhost')
    const res = await handler(req)
    expect(res.headers.get('Access-Control-Allow-Origin')).toBe('*')
  })

  it('adds CORS headers to error response', async () => {
    const handler = withSupabase({ allow: 'user', env: baseEnv }, async () =>
      Response.json({ ok: true }),
    )

    const req = new Request('http://localhost')
    const res = await handler(req)
    expect(res.headers.get('Access-Control-Allow-Origin')).toBe('*')
  })

  it('does not add CORS headers when cors is false', async () => {
    const handler = withSupabase(
      { allow: 'always', env: baseEnv, cors: false },
      async () => Response.json({ ok: true }),
    )

    const req = new Request('http://localhost')
    const res = await handler(req)
    expect(res.headers.get('Access-Control-Allow-Origin')).toBeNull()
  })
})
