import { Hono } from 'hono'
import { describe, expect, expectTypeOf, it } from 'vitest'

import type { SupabaseContext } from '../../types.js'
import { withSupabase } from './middleware.js'

type Env = { Variables: { supabaseContext: SupabaseContext } }

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

type TypedEnv = {
  Variables: {
    supabaseContext: SupabaseContext<Database>
  }
}

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

  it('uses the Hono app env to type the Supabase context', async () => {
    const app = new Hono<TypedEnv>()
    app.use('*', withSupabase({ auth: 'none', env }))
    app.get('/', (c) => {
      // Hono provides two ways to get typed Supabse Context
      const getCtx = c.get('supabaseContext')
      const varCtx = c.var.supabaseContext
      expect(getCtx).toBe(varCtx)

      expectTypeOf(getCtx).toEqualTypeOf<SupabaseContext<Database>>()
      return c.json({ authMode: getCtx.authMode })
    })
    const res = await app.request('/')
    expect(res.status).toBe(200)
  })

  it('uses the Hono adapter to type the Supabase context', async () => {
    // match docs example in typescript-generics.md
    const app = new Hono()
    const rootApp = new Hono()
      .use(withSupabase<Database>({ auth: 'none', env }))
      .get('/', (c) => {
        const ctx = c.var.supabaseContext
        expectTypeOf(ctx).toEqualTypeOf<SupabaseContext<Database>>()
        return c.json({ authMode: ctx.authMode })
      })
    app.route('/', rootApp)

    const res = await app.request('/')
    expect(res.status).toBe(200)
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
