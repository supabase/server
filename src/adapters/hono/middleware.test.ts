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
    app.use('*', withSupabase({ auth: 'none', env }))
    app.get('/', (c) => {
      const ctx = c.get('supabaseContext')
      return c.json({
        authMode: ctx.authMode,
        hasSupabase: !!ctx.supabase,
        hasAdmin: !!ctx.supabaseAdmin,
      })
    })

    const res = await app.request('/')
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.authMode).toBe('none')
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

    // First middleware sets context with 'none' auth
    app.use('*', withSupabase({ auth: 'none', env }))
    // Second middleware would require 'secret' — but should skip
    app.use('*', withSupabase({ auth: 'secret', env }))

    app.get('/', (c) => {
      const ctx = c.get('supabaseContext')
      return c.json({ authMode: ctx.authMode })
    })

    // No apikey header — would fail 'secret' if it ran
    const res = await app.request('/')
    expect(res.status).toBe(200)
    const body = await res.json()
    // First middleware's auth type is preserved
    expect(body.authMode).toBe('none')
  })

  it('does not add CORS headers', async () => {
    const app = new Hono()
    app.use('*', withSupabase({ auth: 'none', env }))
    app.get('/', (c) => c.json({ ok: true }))

    const res = await app.request('/')
    expect(res.headers.get('Access-Control-Allow-Origin')).toBeNull()
  })
})

describe('hono withSupabase fetch-handler form (two-arg)', () => {
  const env = {
    url: 'https://test.supabase.co',
    publishableKeys: { default: 'sb_publishable_xyz' },
    secretKeys: { default: 'sb_publishable_xyz' },
    jwks: null,
  }

  it('mounts directly on app.all and exposes the full ctx to the inner handler', async () => {
    const { withFeatureFlag } =
      await import('../../gates/feature-flag/index.js')

    const app = new Hono()
    app.all(
      '/beta',
      withSupabase(
        { auth: 'none', env },
        withFeatureFlag(
          { name: 'beta', evaluate: (req) => req.headers.has('x-beta') },
          async (_req, ctx) =>
            Response.json({
              authMode: ctx.authMode,
              flag: ctx.featureFlag.name,
              enabled: ctx.featureFlag.enabled,
            }),
        ),
      ),
    )

    const res = await app.request('/beta', { headers: { 'x-beta': '1' } })
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({
      authMode: 'none',
      flag: 'beta',
      enabled: true,
    })
  })

  it("returns the gate's response in place of the inner handler", async () => {
    const { withFeatureFlag } =
      await import('../../gates/feature-flag/index.js')

    const app = new Hono()
    app.all(
      '/beta',
      withSupabase(
        { auth: 'none', env },
        withFeatureFlag({ name: 'beta', evaluate: () => false }, async () =>
          Response.json({ reached: true }),
        ),
      ),
    )

    const res = await app.request('/beta')
    expect(res.status).toBe(404)
    expect(await res.json()).toEqual({
      error: 'feature_disabled',
      flag: 'beta',
    })
  })

  it('returns auth errors as JSON (no HTTPException) — base library behavior', async () => {
    const app = new Hono()
    let onErrorFired = false
    app.onError((err, c) => {
      onErrorFired = true
      return c.json({ caught: err.message })
    })
    app.all(
      '/',
      withSupabase({ auth: 'user', env }, async () =>
        Response.json({ ok: true }),
      ),
    )

    const res = await app.request('/')
    expect(res.status).toBe(401)
    expect(onErrorFired).toBe(false)
  })

  it('also accepts a plain Request directly (Web Fetch use)', async () => {
    const handler = withSupabase({ auth: 'none', env }, async () =>
      Response.json({ ok: true }),
    )

    const res = await handler(new Request('https://example.test/'))
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ ok: true })
  })
})
