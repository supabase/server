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
      .use(withSupabase({ allow: 'always', env }))
      .get('/', ({ supabaseContext }) => ({
        authType: supabaseContext.authType,
        hasSupabase: !!supabaseContext.supabase,
        hasAdmin: !!supabaseContext.supabaseAdmin,
      }))

    const res = await app.handle(new Request('http://localhost/'))
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.authType).toBe('always')
    expect(body.hasSupabase).toBe(true)
    expect(body.hasAdmin).toBe(true)
  })

  it('throws error on auth failure', async () => {
    const app = new Elysia()
      .use(withSupabase({ allow: 'user', env }))
      .get('/', () => ({ ok: true }))

    const res = await app.handle(new Request('http://localhost/'))
    expect(res.status).toBe(401)
    const body = await res.text()
    expect(body).toBeTruthy()
  })

  it('exposes AuthError via cause in onError', async () => {
    const app = new Elysia()
      .use(withSupabase({ allow: 'user', env }))
      .onError(({ code, error, status }) => {
        if (code !== 'SupabaseAuthError') return
        const cause = error.cause as
          | { code?: string; status?: number }
          | undefined
        return status((cause?.status as 401) ?? 500, {
          error: error.message,
          code: cause?.code,
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
      // First plugin sets context with 'always' auth
      .use(withSupabase({ allow: 'always', env }))
      // Second plugin would require 'secret' — but should skip
      .use(withSupabase({ allow: 'secret', env }))
      .get('/', ({ supabaseContext }) => ({
        authType: supabaseContext.authType,
      }))

    // No apikey header — would fail 'secret' if it ran
    const res = await app.handle(new Request('http://localhost/'))
    expect(res.status).toBe(200)
    const body = await res.json()
    // First plugin's auth type is preserved
    expect(body.authType).toBe('always')
  })

  it('does not add CORS headers', async () => {
    const app = new Elysia()
      .use(withSupabase({ allow: 'always', env }))
      .get('/', () => ({ ok: true }))

    const res = await app.handle(new Request('http://localhost/'))
    expect(res.headers.get('Access-Control-Allow-Origin')).toBeNull()
  })
})
