import { H3, HTTPError, onError } from 'h3'
import { describe, expect, it } from 'vitest'

import type { SupabaseContext } from '../../types.js'

import { withSupabase } from './middleware.js'

declare module 'h3' {
  interface H3EventContext {
    supabaseContext: SupabaseContext
  }
}

describe('h3 supabase middleware', () => {
  const env = {
    url: 'https://test.supabase.co',
    publishableKeys: { default: 'sb_publishable_xyz' },
    secretKeys: { default: 'sb_secret_xyz' },
    jwks: null,
  }

  it('sets supabase context on successful auth', async () => {
    const app = new H3()
    app.use(withSupabase({ auth: 'none', env }))
    app.get('/', (event) => {
      const ctx = event.context.supabaseContext
      return {
        authMode: ctx.authMode,
        hasSupabase: !!ctx.supabase,
        hasAdmin: !!ctx.supabaseAdmin,
      }
    })

    const res = await app.request('/')
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.authMode).toBe('none')
    expect(body.hasSupabase).toBe(true)
    expect(body.hasAdmin).toBe(true)
  })

  it('throws HTTPError on auth failure', async () => {
    const app = new H3()
    app.use(withSupabase({ auth: 'user', env }))
    app.get('/', () => ({ ok: true }))

    const res = await app.request('/')
    expect(res.status).toBe(401)
    const body = await res.text()
    expect(body).toBeTruthy()
  })

  it('exposes AuthError via cause in onError hook', async () => {
    const app = new H3()
    app.use(
      onError((error) => {
        // H3's HTTPError sets .cause to the full options object {status, message, cause: AuthError},
        // so the original AuthError is one level deeper at .cause.cause
        const details = error.cause as { cause?: { code?: string } } | undefined
        return Response.json(
          { error: error.message, code: details?.cause?.code },
          { status: HTTPError.isError(error) ? error.status : 500 },
        )
      }),
    )
    app.use(withSupabase({ auth: 'user', env }))
    app.get('/', () => ({ ok: true }))

    const res = await app.request('/')
    expect(res.status).toBe(401)
    const body = await res.json()
    expect(body.error).toBeDefined()
    expect(body.code).toBeDefined()
  })

  it('skips if context is already set by prior middleware', async () => {
    const app = new H3()

    // First middleware sets context with 'none' auth
    app.use(withSupabase({ auth: 'none', env }))
    // Second middleware would require 'secret' — but should skip
    app.use(withSupabase({ auth: 'secret', env }))

    app.get('/', (event) => {
      const ctx = event.context.supabaseContext
      return { authMode: ctx.authMode }
    })

    // No apikey header — would fail 'secret' if it ran
    const res = await app.request('/')
    expect(res.status).toBe(200)
    const body = await res.json()
    // First middleware's auth type is preserved
    expect(body.authMode).toBe('none')
  })

  it('does not add CORS headers', async () => {
    const app = new H3()
    app.use(withSupabase({ auth: 'none', env }))
    app.get('/', () => ({ ok: true }))

    const res = await app.request('/')
    expect(res.headers.get('Access-Control-Allow-Origin')).toBeNull()
  })
})

describe('h3 withSupabase fetch-handler form (two-arg)', () => {
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

    const app = new H3()
    app.all('/beta', (event) => beta(event.req))

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

    const beta = withSupabase(
      { auth: 'none', env },
      withFeatureFlag({ name: 'beta', evaluate: () => false }, async () =>
        Response.json({ reached: true }),
      ),
    )

    const app = new H3()
    app.all('/beta', (event) => beta(event.req))

    const res = await app.request('/beta')
    expect(res.status).toBe(404)
    expect(await res.json()).toEqual({
      error: 'feature_disabled',
      flag: 'beta',
    })
  })

  it('returns auth errors as JSON (no HTTPError) — base library behavior', async () => {
    const handler = withSupabase({ auth: 'user', env }, async () =>
      Response.json({ ok: true }),
    )

    const app = new H3()
    let onErrorFired = false
    app.use(
      onError(() => {
        onErrorFired = true
      }),
    )
    app.all('/', (event) => handler(event.req))

    const res = await app.request('/')
    expect(res.status).toBe(401)
    expect(onErrorFired).toBe(false)
  })

  it('throws a helpful TypeError when passed an H3Event instead of event.req', () => {
    const handler = withSupabase({ auth: 'none', env }, async () =>
      Response.json({ ok: true }),
    )

    const fakeEvent = { req: new Request('https://example.test/'), context: {} }
    try {
      handler(fakeEvent as unknown as Request)
      expect.fail('should have thrown')
    } catch (e) {
      expect(e).toBeInstanceOf(TypeError)
      expect((e as Error).message).toContain('H3Event')
      expect((e as Error).message).toContain('event.req')
    }
  })
})
