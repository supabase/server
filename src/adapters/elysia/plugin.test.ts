import { Elysia } from 'elysia'
import { describe, expect, it } from 'vitest'

import { SupabaseError, withSupabase } from './plugin.js'

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

  it('mounts directly on .all and runs the inner handler with the Supabase ctx', async () => {
    const app = new Elysia().all(
      '/route',
      withSupabase({ auth: 'none', env }, async (_req, ctx) =>
        Response.json({
          authMode: ctx.authMode,
          hasSupabase: !!ctx.supabase,
        }),
      ),
    )

    const res = await app.handle(new Request('http://localhost/route'))
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ authMode: 'none', hasSupabase: true })
  })

  it('throws SupabaseError on auth failure so onError handles it (consistent with one-arg form)', async () => {
    let caughtCode: string | undefined
    const app = new Elysia()
      .error({ SupabaseError })
      .onError(({ code, error, status }) => {
        if (code !== 'SupabaseError') return
        caughtCode = error.cause.code
        return status(error.status as 401, {
          error: error.message,
          code: error.cause.code,
        })
      })
      .all(
        '/',
        withSupabase({ auth: 'user', env }, async () =>
          Response.json({ ok: true }),
        ),
      )

    const res = await app.handle(new Request('http://localhost/'))
    expect(res.status).toBe(401)
    expect(caughtCode).toBeDefined()
  })

  it('skips re-running auth when an upstream plugin already resolved supabaseContext', async () => {
    let innerHandlerCalls = 0
    const app = new Elysia().use(withSupabase({ auth: 'none', env })).all(
      '/protected',
      withSupabase({ auth: 'secret', env }, async (_req, ctx) => {
        innerHandlerCalls++
        return Response.json({ authMode: ctx.authMode })
      }),
    )

    // No apikey header — would fail 'secret' if the two-arg form re-ran auth
    const res = await app.handle(new Request('http://localhost/protected'))
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.authMode).toBe('none')
    expect(innerHandlerCalls).toBe(1)
  })

  it('also accepts a plain Request directly (Web Fetch use)', async () => {
    const handler = withSupabase({ auth: 'none', env }, async () =>
      Response.json({ ok: true }),
    )

    const res = await handler(new Request('http://localhost/'))
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ ok: true })
  })
})
