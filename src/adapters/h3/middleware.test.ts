import { H3, HTTPError, onError } from 'h3'
import { describe, expect, it } from 'vitest'

import { withSupabase } from './middleware.js'

describe('h3 supabase middleware', () => {
  const env = {
    url: 'https://test.supabase.co',
    publishableKeys: { default: 'sb_publishable_xyz' },
    secretKeys: { default: 'sb_publishable_xyz' },
    jwks: null,
  }

  it('sets supabase context on successful auth', async () => {
    const app = new H3()
    app.use(withSupabase({ allow: 'always', env }))
    app.get('/', (event) => {
      const ctx = event.context.supabaseContext
      return {
        authType: ctx.authType,
        hasSupabase: !!ctx.supabase,
        hasAdmin: !!ctx.supabaseAdmin,
      }
    })

    const res = await app.request('/')
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.authType).toBe('always')
    expect(body.hasSupabase).toBe(true)
    expect(body.hasAdmin).toBe(true)
  })

  it('throws HTTPError on auth failure', async () => {
    const app = new H3()
    app.use(withSupabase({ allow: 'user', env }))
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
    app.use(withSupabase({ allow: 'user', env }))
    app.get('/', () => ({ ok: true }))

    const res = await app.request('/')
    expect(res.status).toBe(401)
    const body = await res.json()
    expect(body.error).toBeDefined()
    expect(body.code).toBeDefined()
  })

  it('skips if context is already set by prior middleware', async () => {
    const app = new H3()

    // First middleware sets context with 'always' auth
    app.use(withSupabase({ allow: 'always', env }))
    // Second middleware would require 'secret' — but should skip
    app.use(withSupabase({ allow: 'secret', env }))

    app.get('/', (event) => {
      const ctx = event.context.supabaseContext
      return { authType: ctx.authType }
    })

    // No apikey header — would fail 'secret' if it ran
    const res = await app.request('/')
    expect(res.status).toBe(200)
    const body = await res.json()
    // First middleware's auth type is preserved
    expect(body.authType).toBe('always')
  })

  it('does not add CORS headers', async () => {
    const app = new H3()
    app.use(withSupabase({ allow: 'always', env }))
    app.get('/', () => ({ ok: true }))

    const res = await app.request('/')
    expect(res.headers.get('Access-Control-Allow-Origin')).toBeNull()
  })
})
