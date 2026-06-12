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

  it('mounts directly on app.all and runs the inner handler with the Supabase ctx', async () => {
    const app = new H3()
    app.all(
      '/route',
      withSupabase({ auth: 'none', env }, async (_req, ctx) =>
        Response.json({
          authMode: ctx.authMode,
          hasSupabase: !!ctx.supabase,
        }),
      ),
    )

    const res = await app.request('/route')
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ authMode: 'none', hasSupabase: true })
  })

  it('throws HTTPError on auth failure so onError handles it (consistent with one-arg form)', async () => {
    const app = new H3()
    let caught: unknown
    app.use(
      onError((error) => {
        caught = error
        return Response.json(
          { caught: (error as Error).message },
          { status: HTTPError.isError(error) ? error.status : 500 },
        )
      }),
    )
    app.all(
      '/',
      withSupabase({ auth: 'user', env }, async () =>
        Response.json({ ok: true }),
      ),
    )

    const res = await app.request('/')
    expect(res.status).toBe(401)
    expect(caught).toBeDefined()
    expect(HTTPError.isError(caught)).toBe(true)
  })

  it('skips re-running auth when an upstream middleware already set event.context.supabaseContext', async () => {
    const app = new H3()
    app.use(withSupabase({ auth: 'none', env }))

    let innerHandlerCalls = 0
    app.all(
      '/protected',
      withSupabase({ auth: 'secret', env }, async (_req, ctx) => {
        innerHandlerCalls++
        return Response.json({ authMode: ctx.authMode })
      }),
    )

    // No apikey header — would fail 'secret' if the two-arg form re-ran auth
    const res = await app.request('/protected')
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.authMode).toBe('none')
    expect(innerHandlerCalls).toBe(1)
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
