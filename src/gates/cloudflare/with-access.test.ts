import { exportJWK, generateKeyPair, SignJWT, type KeyObject } from 'jose'
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'

import { withAccess } from './with-access.js'

const TEAM_DOMAIN = 'acme.cloudflareaccess.com'
const ISSUER = `https://${TEAM_DOMAIN}`
const AUDIENCE =
  '8c6f8a7d36b4f8e9d6e7c5a4b3a2f1e0d9c8b7a6e5f4d3c2b1a0f9e8d7c6b5a4'

const fetchMock = vi.fn()
vi.stubGlobal('fetch', fetchMock)

let privateKey: KeyObject
let kid: string

beforeAll(async () => {
  const pair = await generateKeyPair('RS256')
  privateKey = pair.privateKey as KeyObject
  const jwk = await exportJWK(pair.publicKey)
  kid = 'test-key'
  const jwks = { keys: [{ ...jwk, kid, alg: 'RS256', use: 'sig' }] }
  // Every fetch in these tests goes to the JWKS endpoint.
  fetchMock.mockImplementation(async () =>
    Response.json(jwks, { headers: { 'cache-control': 'max-age=60' } }),
  )
})

afterEach(() => {
  fetchMock.mockClear()
})

const sign = (
  overrides: { aud?: string | string[]; email?: string; sub?: string } = {},
) =>
  new SignJWT({
    email: overrides.email ?? 'user@example.com',
    identity_nonce: 'nonce-abc',
  })
    .setProtectedHeader({ alg: 'RS256', kid })
    .setIssuer(ISSUER)
    .setAudience(overrides.aud ?? AUDIENCE)
    .setSubject(overrides.sub ?? 'user-123')
    .setIssuedAt()
    .setExpirationTime('5m')
    .sign(privateKey)

const baseConfig = { teamDomain: TEAM_DOMAIN, audience: AUDIENCE }
const innerOk = async () => Response.json({ ok: true })

describe('withAccess', () => {
  it('rejects when the assertion header is missing', async () => {
    const handler = withAccess(baseConfig, innerOk)

    const res = await handler(new Request('http://localhost/'))

    expect(res.status).toBe(401)
    expect(await res.json()).toEqual({ error: 'access_token_missing' })
  })

  it('admits a valid token and contributes identity to ctx.access', async () => {
    const token = await sign()

    const inner = vi.fn(async (_req: Request, ctx) => {
      expect(ctx.access.email).toBe('user@example.com')
      expect(ctx.access.sub).toBe('user-123')
      expect(ctx.access.identityNonce).toBe('nonce-abc')
      expect(ctx.access.audience).toBe(AUDIENCE)
      expect(ctx.access.claims.iss).toBe(ISSUER)
      return Response.json({ ok: true })
    })

    const handler = withAccess(baseConfig, inner)

    const res = await handler(
      new Request('http://localhost/', {
        headers: { 'cf-access-jwt-assertion': token },
      }),
    )

    expect(res.status).toBe(200)
    expect(inner).toHaveBeenCalledOnce()
  })

  it('rejects a token with the wrong audience', async () => {
    const token = await sign({ aud: 'someone-elses-audience' })

    const handler = withAccess(baseConfig, innerOk)

    const res = await handler(
      new Request('http://localhost/', {
        headers: { 'cf-access-jwt-assertion': token },
      }),
    )

    expect(res.status).toBe(401)
    const body = await res.json()
    expect(body.error).toBe('access_token_invalid')
  })

  it('rejects a malformed assertion', async () => {
    const handler = withAccess(baseConfig, innerOk)

    const res = await handler(
      new Request('http://localhost/', {
        headers: { 'cf-access-jwt-assertion': 'not.a.jwt' },
      }),
    )

    expect(res.status).toBe(401)
    expect((await res.json()).error).toBe('access_token_invalid')
  })
})
