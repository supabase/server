import { exportJWK, generateKeyPair, generateSecret, SignJWT } from 'jose'
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'

import type { JSONWebKeySet } from 'jose'

import { InvalidCredentialsError } from '../../errors.js'
import { withClaims } from './index.js'

describe('withClaims', () => {
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

  function requestWithToken(token?: string): Request {
    return new Request('http://localhost', {
      headers: token ? { Authorization: `Bearer ${token}` } : {},
    })
  }

  it('contributes JWKS-verified claims for a valid token', async () => {
    for (const token of [() => rsToken, () => hsToken]) {
      let seen: unknown
      const handler = withClaims({ jwks }, async (_req, ctx) => {
        seen = ctx.jwtClaims
        return Response.json({ ok: true })
      })

      const res = await handler(requestWithToken(token()))
      expect(res.status).toBe(200)
      expect(seen).toMatchObject({ sub: 'user-123', role: 'authenticated' })
    }
  })

  it('short-circuits 401 for a token signed by an unknown key', async () => {
    const handler = withClaims({ jwks }, async () =>
      Response.json({ ok: true }),
    )

    const res = await handler(requestWithToken(foreignToken))
    expect(res.status).toBe(401)
    const body = await res.json()
    expect(body.code).toBe(InvalidCredentialsError)
  })

  it('short-circuits 401 for a malformed token', async () => {
    const handler = withClaims({ jwks }, async () =>
      Response.json({ ok: true }),
    )

    const res = await handler(requestWithToken('not-a-jwt'))
    expect(res.status).toBe(401)
  })

  it('contributes null when no Authorization header is present', async () => {
    let seen: unknown = 'unset'
    const handler = withClaims({ jwks }, async (_req, ctx) => {
      seen = ctx.jwtClaims
      return Response.json({ ok: true })
    })

    // Called bare, the way a runtime invokes a fetch entry — no prerequisites.
    const res = await handler(requestWithToken())
    expect(res.status).toBe(200)
    expect(seen).toBeNull()
  })

  it('contributes null for an sb_* secret in the Authorization header', async () => {
    let seen: unknown = 'unset'
    const handler = withClaims({ jwks }, async (_req, ctx) => {
      seen = ctx.jwtClaims
      return Response.json({ ok: true })
    })

    const res = await handler(requestWithToken('sb_secret_xyz'))
    expect(res.status).toBe(200)
    expect(seen).toBeNull()
  })

  afterEach(() => {
    vi.unstubAllEnvs()
  })

  it('short-circuits 500 when a token is present but no JWKS is configured', async () => {
    vi.stubEnv('SUPABASE_JWKS', '')
    vi.stubEnv('SUPABASE_JWKS_URL', '')
    const handler = withClaims(async () => Response.json({ ok: true }))

    const res = await handler(requestWithToken(rsToken))
    expect(res.status).toBe(500)
    const body = await res.json()
    expect(body.message).toContain('JWKS')
  })
})
