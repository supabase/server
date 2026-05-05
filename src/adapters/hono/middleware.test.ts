import { Hono } from 'hono'
import { describe, expect, it } from 'vitest'

import type { SupabaseContext } from '../../types.js'
import { withSupabase } from './middleware.js'

type Env = { Variables: { supabaseContext: SupabaseContext } }

describe('hono supabase middleware', () => {
  const env = {
    url: 'https://test.supabase.co',
    publishableKeys: { default: 'sb_publishable_xyz' },
    secretKeys: { default: 'sb_publishable_xyz' },
    jwks: null,
  }

  it('sets supabase context on successful auth', async () => {
    const app = new Hono<Env>()
    app.use('*', withSupabase({ auth: 'always', env }))
    app.get('/', (c) => {
      const ctx = c.get('supabaseContext')
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
    app.use('*', withSupabase({ auth: 'user', env }))
    app.get('/', (c) => c.json({ ok: true }))

    const res = await app.request('/')
    expect(res.status).toBe(401)
    const body = await res.text()
    expect(body).toBeTruthy()
  })

  it('exposes AuthError via cause in app.onError', async () => {
    const app = new Hono()
    app.use('*', withSupabase({ auth: 'user', env }))
    app.get('/', (c) => c.json({ ok: true }))
    app.onError((err, c) => {
      const cause = (err as Error).cause as
        | { code?: string; status?: number }
        | undefined
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

  it('skips if context is already set by prior middleware', async () => {
    const app = new Hono<Env>()

    // First middleware sets context with 'always' auth
    app.use('*', withSupabase({ auth: 'always', env }))
    // Second middleware would require 'secret' — but should skip
    app.use('*', withSupabase({ auth: 'secret', env }))

    app.get('/', (c) => {
      const ctx = c.get('supabaseContext')
      return c.json({ authType: ctx.authType })
    })

    // No apikey header — would fail 'secret' if it ran
    const res = await app.request('/')
    expect(res.status).toBe(200)
    const body = await res.json()
    // First middleware's auth type is preserved
    expect(body.authType).toBe('always')
  })

  it('does not add CORS headers', async () => {
    const app = new Hono()
    app.use('*', withSupabase({ auth: 'always', env }))
    app.get('/', (c) => c.json({ ok: true }))

    const res = await app.request('/')
    expect(res.headers.get('Access-Control-Allow-Origin')).toBeNull()
  })
})
