import { Elysia } from 'elysia'
import { describe, expect, expectTypeOf, it } from 'vitest'

import type { SupabaseContext } from '../../types.js'
import { withSupabase } from './plugin.js'

type Database = {
  public: {
    Tables: {
      todos: {
        Row: { id: number; title: string }
        Insert: { id?: number; title: string }
        Update: { id?: number; title?: string }
        Relationships: []
      }
    }
  }
}

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

  it('threads the Database generic into the Supabase context', async () => {
    const app = new Elysia()
      .use(withSupabase<Database>({ auth: 'none', env }))
      .get('/', ({ supabaseContext }) => {
        expectTypeOf(supabaseContext).toEqualTypeOf<SupabaseContext<Database>>()
        return { authMode: supabaseContext.authMode }
      })

    const res = await app.handle(new Request('http://localhost/'))
    expect(res.status).toBe(200)
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
