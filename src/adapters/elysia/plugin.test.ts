import { Elysia } from 'elysia'
import { describe, expect, it } from 'vitest'

import { withSupabase } from './plugin.js'

describe('elysia supabase plugin', () => {
  const env = {
    url: 'https://test.supabase.co',
    publishableKeys: { default: 'sb_publishable_xyz' },
    secretKeys: { default: 'sb_secret_xyz' },
    jwks: null,
  }

  it('sets supabase context on successful auth', async () => {
    const app = new Elysia()
      .use(withSupabase({ auth: 'none', env }))
      .get('/', ({ supabaseContext }) => ({
        authMode: supabaseContext.authMode,
        hasSupabase: !!supabaseContext.supabase,
        hasAdmin: !!supabaseContext.supabaseAdmin,
      }))

    const res = await app.handle(new Request('http://localhost/'))
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.authMode).toBe('none')
    expect(body.hasSupabase).toBe(true)
    expect(body.hasAdmin).toBe(true)
  })

  it('throws error on auth failure', async () => {
    const app = new Elysia()
      .use(withSupabase({ auth: 'user', env }))
      .get('/', () => ({ ok: true }))

    const res = await app.handle(new Request('http://localhost/'))
    expect(res.status).toBe(401)
    const body = await res.text()
    expect(body).toBeTruthy()
  })

  it('exposes SupabaseError in onError', async () => {
    const app = new Elysia()
      .use(withSupabase({ auth: 'user', env }))
      .onError(({ code, error, status }) => {
        if (code !== 'SupabaseError') return
        return status(error.status as 401, {
          error: error.message,
          code: error.cause.code,
        })
      })
      .get('/', () => ({ ok: true }))

    const res = await app.handle(new Request('http://localhost/'))
    expect(res.status).toBe(401)
    const body = await res.json()
    expect(body.error).toBeDefined()
    expect(body.code).toBeDefined()
  })

  it('skips if context is already set by prior plugin', async () => {
    const app = new Elysia()
      // First plugin sets context with 'none' auth
      .use(withSupabase({ auth: 'none', env }))
      // Second plugin would require 'secret' — but should skip
      .use(withSupabase({ auth: 'secret', env }))
      .get('/', ({ supabaseContext }) => ({
        authMode: supabaseContext.authMode,
      }))

    // No apikey header — would fail 'secret' if it ran
    const res = await app.handle(new Request('http://localhost/'))
    expect(res.status).toBe(200)
    const body = await res.json()
    // First plugin's auth mode is preserved
    expect(body.authMode).toBe('none')
  })

  it('does not add CORS headers', async () => {
    const app = new Elysia()
      .use(withSupabase({ auth: 'none', env }))
      .get('/', () => ({ ok: true }))

    const res = await app.handle(new Request('http://localhost/'))
    expect(res.headers.get('Access-Control-Allow-Origin')).toBeNull()
  })
})

describe('elysia withSupabase fetch-handler form (two-arg)', () => {
  const env = {
    url: 'https://test.supabase.co',
    publishableKeys: { default: 'sb_publishable_xyz' },
    secretKeys: { default: 'sb_secret_xyz' },
    jwks: null,
  }

  it('composes with a gate and exposes the full ctx to the inner handler', async () => {
    const { withFeatureFlag } =
      await import('../../gates/feature-flag/index.js')

    const beta = withSupabase(
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
    )

    const app = new Elysia().all('/beta', ({ request }) => beta(request))

    const res = await app.handle(
      new Request('http://localhost/beta', { headers: { 'x-beta': '1' } }),
    )
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

    const beta = withSupabase(
      { auth: 'none', env },
      withFeatureFlag({ name: 'beta', evaluate: () => false }, async () =>
        Response.json({ reached: true }),
      ),
    )

    const app = new Elysia().all('/beta', ({ request }) => beta(request))

    const res = await app.handle(new Request('http://localhost/beta'))
    expect(res.status).toBe(404)
    expect(await res.json()).toEqual({
      error: 'feature_disabled',
      flag: 'beta',
    })
  })

  it('returns auth errors as JSON (no SupabaseError) — base library behavior', async () => {
    const handler = withSupabase({ auth: 'user', env }, async () =>
      Response.json({ ok: true }),
    )

    let onErrorFired = false
    const app = new Elysia()
      .onError(() => {
        onErrorFired = true
      })
      .all('/', ({ request }) => handler(request))

    const res = await app.handle(new Request('http://localhost/'))
    expect(res.status).toBe(401)
    expect(onErrorFired).toBe(false)
  })
})
