import { Hono } from 'hono'
import { describe, expect, it } from 'vitest'

import { supabase } from './middleware.js'

describe('hono supabase middleware', () => {
  const env = {
    url: 'https://test.supabase.co',
    publishableKeys: [{ name: 'default', key: 'pk_test' }],
    secretKeys: [{ name: 'default', key: 'sk_test' }],
    jwks: null,
  }

  it('sets supabase context on successful auth', async () => {
    const app = new Hono()
    app.use('*', supabase({ allow: 'always', env }))
    app.get('/', (c) => {
      const ctx = c.get('supabase')
      return c.json({
        authType: ctx.authType,
        hasSupabase: !!ctx.supabase,
        hasAdmin: !!ctx.supabaseAdmin,
      })
    })

    const res = await app.request('/')
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.authType).toBe('always')
    expect(body.hasSupabase).toBe(true)
    expect(body.hasAdmin).toBe(true)
  })

  it('throws HTTPException on auth failure', async () => {
    const app = new Hono()
    app.use('*', supabase({ allow: 'user', env }))
    app.get('/', (c) => c.json({ ok: true }))

    const res = await app.request('/')
    expect(res.status).toBe(401)
    const body = await res.text()
    expect(body).toBeTruthy()
  })

  it('exposes AuthError via cause in app.onError', async () => {
    const app = new Hono()
    app.use('*', supabase({ allow: 'user', env }))
    app.get('/', (c) => c.json({ ok: true }))
    app.onError((err, c) => {
      const cause = err.cause as { code?: string; status?: number }
      return c.json(
        { error: err.message, code: cause?.code },
        (cause?.status as 401) ?? 500,
      )
    })

    const res = await app.request('/')
    expect(res.status).toBe(401)
    const body = await res.json()
    expect(body.error).toBeDefined()
    expect(body.code).toBeDefined()
  })

  it('does not add CORS headers', async () => {
    const app = new Hono()
    app.use('*', supabase({ allow: 'always', env }))
    app.get('/', (c) => c.json({ ok: true }))

    const res = await app.request('/')
    expect(res.headers.get('Access-Control-Allow-Origin')).toBeNull()
  })
})
