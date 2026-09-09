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

import {
  InvalidJwtError,
  JwksNotConfiguredError,
  MissingCredentialsError,
  UnusableCredentialError,
} from '../../errors.js'
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
    expect(body.code).toBe(MissingCredentialsError)
    expect(ran).toBe(false)
  })

  it('short-circuits 401 UNUSABLE_CREDENTIAL for an sb_* apikey in the Authorization header', async () => {
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
      expect(body.code).toBe(UnusableCredentialError)
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
    expect(body.code).toBe(InvalidJwtError)
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
    expect(body.code).toBe(JwksNotConfiguredError)
    expect(body.message).toContain('JWKS')
    // The hint names the middleware's own option, not `env.jwks`.
    expect(body.hint).toContain('withRequiredClaims()')
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
    expect(body.code).toBe(MissingCredentialsError)
  })

  describe('parity with withSupabase auth: "user"', () => {
    // Both gates share `verifyUserJwt`; these tests pin the rest of the
    // contract — the same request yields the same status and error code
    // through either entry point.
    const supabaseEnv = (jwksSource: JSONWebKeySet | null) => ({
      url: 'https://test.supabase.co',
      publishableKeys: { default: 'sb_publishable_xyz' },
      secretKeys: { default: 'sb_secret_xyz' },
      jwks: jwksSource,
    })

    async function both(
      token: string | undefined,
      jwksSource: JSONWebKeySet | null,
    ) {
      const gated = withRequiredClaims(
        jwksSource ? { jwks: jwksSource } : undefined,
        async (_req, ctx) => Response.json({ sub: ctx.jwtClaims.sub }),
      )
      const wrapped = withSupabase(
        { auth: 'user', cors: 'disabled', env: supabaseEnv(jwksSource) },
        async (_req, ctx) => Response.json({ sub: ctx.jwtClaims!.sub }),
      )
      return {
        gate: await gated(requestWithToken(token)),
        supabase: await wrapped(requestWithToken(token)),
      }
    }

    it('valid token: both run the handler with the same subject', async () => {
      const { gate, supabase } = await both(rsToken, jwks)
      expect(gate.status).toBe(200)
      expect(supabase.status).toBe(200)
      expect(await gate.json()).toEqual(await supabase.json())
    })

    it('missing token: both 401 MISSING_CREDENTIALS', async () => {
      const { gate, supabase } = await both(undefined, jwks)
      for (const res of [gate, supabase]) {
        expect(res.status).toBe(401)
        expect((await res.json()).code).toBe(MissingCredentialsError)
      }
    })

    it('sb_* key in the Authorization slot: both 401 UNUSABLE_CREDENTIAL', async () => {
      const { gate, supabase } = await both('sb_secret_other', jwks)
      for (const res of [gate, supabase]) {
        expect(res.status).toBe(401)
        expect((await res.json()).code).toBe(UnusableCredentialError)
      }
    })

    it('token signed by an unknown key: both 401 INVALID_JWT', async () => {
      const { gate, supabase } = await both(foreignToken, jwks)
      for (const res of [gate, supabase]) {
        expect(res.status).toBe(401)
        expect((await res.json()).code).toBe(InvalidJwtError)
      }
    })

    // Every shape the Authorization header can arrive in, since only the raw
    // header distinguishes "sent nothing" from "sent something unreadable" —
    // and the two entry points read it through the same classifier.
    it.each([
      ['no header', undefined, 'MISSING_CREDENTIALS'],
      ['sb_* API key', 'Bearer sb_secret_other', 'UNUSABLE_CREDENTIAL'],
      ['Basic scheme', 'Basic dXNlcjpwYXNz', 'UNUSABLE_CREDENTIAL'],
      ['lowercased bearer', 'bearer a.b.c', 'UNUSABLE_CREDENTIAL'],
      ['bare value, no scheme', 'a.b.c', 'UNUSABLE_CREDENTIAL'],
      ['Bearer with empty token', 'Bearer', 'UNUSABLE_CREDENTIAL'],
    ])(
      'Authorization %s: both 401 %s',
      async (_label, authorization, expectedCode) => {
        const req = () =>
          new Request('http://localhost', {
            headers: authorization ? { Authorization: authorization } : {},
          })
        const gated = withRequiredClaims({ jwks }, async () =>
          Response.json({ ok: true }),
        )
        const wrapped = withSupabase(
          { auth: 'user', cors: 'disabled', env: supabaseEnv(jwks) },
          async () => Response.json({ ok: true }),
        )

        for (const res of [await gated(req()), await wrapped(req())]) {
          expect(res.status).toBe(401)
          expect((await res.json()).code).toBe(expectedCode)
        }
      },
    )

    it('token present but no JWKS configured: both 500 JWKS_NOT_CONFIGURED', async () => {
      vi.stubEnv('SUPABASE_JWKS', '')
      vi.stubEnv('SUPABASE_JWKS_URL', '')
      const { gate, supabase } = await both(rsToken, null)
      for (const res of [gate, supabase]) {
        expect(res.status).toBe(500)
        expect((await res.json()).code).toBe(JwksNotConfiguredError)
      }
    })
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

  it('gating after withSupabase in a pipeline is a compile-time conflict', () => {
    // withSupabase verifies credentials and contributes jwtClaims itself, so a
    // gate placed after it collides on the key.
    const _bad = pipeline(
      [withSupabase({ auth: 'none', env: baseEnv }), withRequiredClaims()],
      // @ts-expect-error — Conflict<'jwtClaims'>: key already on the context
      async () => Response.json({ ok: true }),
    )
    void _bad
  })
})
