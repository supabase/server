import { pipeline } from '@supabase/middleware'
import { exportJWK, generateKeyPair, generateSecret, SignJWT } from 'jose'
import {
  afterEach,
  beforeAll,
  describe,
  expect,
  expectTypeOf,
  it,
  vi,
} from 'vitest'

import type { JSONWebKeySet } from 'jose'

import { EnvGenericError, InvalidCredentialsError } from '../../errors.js'
import { withSupabase } from '../../with-supabase.js'
import { withClaims } from '../claims/index.js'
import { withPostgresClient } from '../postgres/index.js'
import { withRequiredClaims } from './index.js'

import type { JWTClaims } from '../../types.js'

describe('withRequiredClaims', () => {
  let jwks: JSONWebKeySet
  let rsToken: string
  let hsToken: string
  let foreignToken: string

  beforeAll(async () => {
    // Asymmetric JWK
    const { privateKey, publicKey } = await generateKeyPair('RS256')
    const publicJwk = await exportJWK(publicKey)
    publicJwk.alg = 'RS256'
    publicJwk.use = 'sig'
    publicJwk.kid = 'asymmetric-key-id'

    // Symmetric Shared Secret JWK
    const jwtSecret = await generateSecret('HS256', { extractable: true })
    const symmetricJwk = await exportJWK(jwtSecret)
    symmetricJwk.alg = 'HS256'
    symmetricJwk.kid = 'symmetric-shared-secret-key-id'

    jwks = { keys: [publicJwk, symmetricJwk] }

    const signWith = (
      key: CryptoKey | Uint8Array<ArrayBufferLike>,
      alg: string,
      kid: string,
    ) =>
      new SignJWT({ sub: 'user-123', role: 'authenticated' })
        .setProtectedHeader({ alg, kid })
        .setIssuedAt()
        .setExpirationTime('1h')
        .sign(key)

    rsToken = await signWith(privateKey, 'RS256', publicJwk.kid!)
    hsToken = await signWith(jwtSecret, 'HS256', symmetricJwk.kid!)

    // Signed by a key that is NOT in the JWKS — verification must fail.
    const { privateKey: foreignKey } = await generateKeyPair('RS256')
    foreignToken = await signWith(foreignKey, 'RS256', publicJwk.kid!)
  })

  afterEach(() => {
    vi.unstubAllEnvs()
  })

  function requestWithToken(token?: string): Request {
    return new Request('http://localhost', {
      headers: token ? { Authorization: `Bearer ${token}` } : {},
    })
  }

  it('contributes JWKS-verified claims for a valid token', async () => {
    for (const token of [() => rsToken, () => hsToken]) {
      let seen: unknown
      const handler = withRequiredClaims({ jwks }, async (_req, ctx) => {
        seen = ctx.jwtClaims
        return Response.json({ ok: true })
      })

      const res = await handler(requestWithToken(token()))
      expect(res.status).toBe(200)
      expect(seen).toMatchObject({ sub: 'user-123', role: 'authenticated' })
    }
  })

  it('short-circuits 401 when no Authorization header is present', async () => {
    let ran = false
    const handler = withRequiredClaims({ jwks }, async () => {
      ran = true
      return Response.json({ ok: true })
    })

    const res = await handler(requestWithToken())
    expect(res.status).toBe(401)
    const body = await res.json()
    expect(body.code).toBe(InvalidCredentialsError)
    expect(ran).toBe(false)
  })

  it('short-circuits 401 for an sb_* apikey in the Authorization header', async () => {
    let ran = false
    const handler = withRequiredClaims({ jwks }, async () => {
      ran = true
      return Response.json({ ok: true })
    })

    const apikeys = [
      'sb_publishable_xyz',
      'sb_secret_xyz',
      'sb_temp_xyz',
      'sb_something',
    ]

    for (const apikey of apikeys) {
      const res = await handler(requestWithToken(apikey))
      expect(res.status).toBe(401)
      const body = await res.json()
      expect(body.code).toBe(InvalidCredentialsError)
      expect(ran).toBe(false)
    }
  })

  it('short-circuits 401 for a token signed by an unknown key', async () => {
    const handler = withRequiredClaims({ jwks }, async () =>
      Response.json({ ok: true }),
    )

    const res = await handler(requestWithToken(foreignToken))
    expect(res.status).toBe(401)
    const body = await res.json()
    expect(body.code).toBe(InvalidCredentialsError)
  })

  it('short-circuits 401 for a malformed token', async () => {
    const handler = withRequiredClaims({ jwks }, async () =>
      Response.json({ ok: true }),
    )

    const res = await handler(requestWithToken('not-a-jwt'))
    expect(res.status).toBe(401)
  })

  it('short-circuits 500 when a token is present but no JWKS is configured', async () => {
    vi.stubEnv('SUPABASE_JWKS', '')
    vi.stubEnv('SUPABASE_JWKS_URL', '')
    const handler = withRequiredClaims(async () => Response.json({ ok: true }))

    const res = await handler(requestWithToken(rsToken))
    expect(res.status).toBe(500)
    const body = await res.json()
    expect(body.code).toBe(EnvGenericError)
    expect(body.message).toContain('JWKS')
  })

  it('short-circuits 401 when neither a token nor a JWKS is present', async () => {
    // Missing credentials are the caller's problem and are reported before
    // missing configuration: the JWKS is never resolved for a request that
    // carries nothing to verify.
    vi.stubEnv('SUPABASE_JWKS', '')
    vi.stubEnv('SUPABASE_JWKS_URL', '')
    const handler = withRequiredClaims(async () => Response.json({ ok: true }))

    const res = await handler(requestWithToken())
    expect(res.status).toBe(401)
    const body = await res.json()
    expect(body.code).toBe(InvalidCredentialsError)
  })
})

describe('withRequiredClaims composition (type-level)', () => {
  const baseEnv = {
    url: 'https://test.supabase.co',
    publishableKeys: { default: 'sb_publishable_xyz' },
    secretKeys: { default: 'sb_secret_xyz' },
    jwks: null,
  }

  it('satisfies withPostgresClient and the handler sees non-null claims', () => {
    const _handler = pipeline(
      [withRequiredClaims(), withPostgresClient()],
      async (_req, ctx) => {
        expectTypeOf(ctx.jwtClaims).toEqualTypeOf<JWTClaims>()
        expectTypeOf(ctx.postgres).not.toBeAny()
        return Response.json({ ok: true })
      },
    )
    void _handler
  })

  it('composing with withClaims is a compile-time conflict (gate first)', () => {
    const _bad = pipeline(
      [withRequiredClaims(), withClaims()],
      // @ts-expect-error — Conflict<'jwtClaims'>: both entries contribute the key
      async () => Response.json({ ok: true }),
    )
    void _bad
  })

  it('composing with withClaims is a compile-time conflict (withClaims first)', () => {
    const _bad = pipeline(
      [withClaims(), withRequiredClaims()],
      // @ts-expect-error — Conflict<'jwtClaims'>: both entries contribute the key
      async () => Response.json({ ok: true }),
    )
    void _bad
  })

  it('gating inside withSupabase is a compile-time conflict', () => {
    // withSupabase already verifies credentials and seeds jwtClaims before
    // the middleware array runs, so the gate is redundant there.
    // @ts-expect-error — Conflict<'jwtClaims'>: key already on the context
    const _bad = withSupabase(
      { auth: 'none', env: baseEnv, middleware: [withRequiredClaims()] },
      async () => Response.json({ ok: true }),
    )
    void _bad
  })
})
