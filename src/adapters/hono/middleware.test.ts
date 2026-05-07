import { exportJWK, generateKeyPair, SignJWT } from 'jose'
import { Hono } from 'hono'
import { beforeAll, describe, expect, it } from 'vitest'

import type {
  JsonWebKeySet,
  SupabaseContext,
  SupabaseEnv,
  SupabaseUserContext,
} from '../../types.js'
import { withSupabase, withSupabaseUserAuth } from './middleware.js'

type Env = { Variables: { supabaseContext: SupabaseContext } }
type UserEnv = { Variables: { supabaseUserContext: SupabaseUserContext } }

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

describe('hono supabase user auth middleware', () => {
  let jwks: JsonWebKeySet
  let makeToken: (claims?: Record<string, unknown>) => Promise<string>

  beforeAll(async () => {
    const { privateKey, publicKey } = await generateKeyPair('RS256')
    const publicJwk = await exportJWK(publicKey)
    publicJwk.alg = 'RS256'
    publicJwk.use = 'sig'
    jwks = { keys: [publicJwk] }

    makeToken = async (claims = {}) => {
      let jwt = new SignJWT({
        sub: 'user-123',
        role: 'authenticated',
        email: 'test@example.com',
        ...claims,
      })
        .setProtectedHeader({ alg: 'RS256' })
        .setIssuedAt()
        .setExpirationTime('1h')
      if (!('aud' in claims)) {
        jwt = jwt.setAudience('authenticated')
      }
      return jwt.sign(privateKey)
    }
  })

  function makeEnv(overrides?: Partial<SupabaseEnv>): Partial<SupabaseEnv> {
    return {
      url: 'https://test.supabase.co',
      publishableKeys: { default: 'sb_publishable_xyz' },
      secretKeys: {},
      jwks,
      ...overrides,
    }
  }

  it('sets a user-scoped context without a secret key', async () => {
    const token = await makeToken()
    const app = new Hono<UserEnv>()
    app.use(
      '*',
      withSupabaseUserAuth({
        userId: 'user-123',
        env: makeEnv(),
      }),
    )
    app.get('/', (c) => {
      const ctx = c.get('supabaseUserContext')
      return c.json({
        hasSupabase: !!ctx.supabase,
        hasAdmin:
          'supabaseAdmin' in (ctx as unknown as Record<string, unknown>),
        tokenMatches: ctx.token === token,
        userId: ctx.userClaims.id,
      })
    })

    const res = await app.request('/', {
      headers: { Authorization: `Bearer ${token}` },
    })

    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body).toEqual({
      hasSupabase: true,
      hasAdmin: false,
      tokenMatches: true,
      userId: 'user-123',
    })
  })

  it('rejects a token for a different user ID', async () => {
    const token = await makeToken()
    const app = new Hono<UserEnv>()
    app.use(
      '*',
      withSupabaseUserAuth({
        userId: 'user-456',
        env: makeEnv(),
      }),
    )
    app.get('/', (c) => c.json({ ok: true }))

    const res = await app.request('/', {
      headers: { Authorization: `Bearer ${token}` },
    })

    expect(res.status).toBe(401)
  })
})
