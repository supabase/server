import { exportJWK, generateKeyPair, SignJWT } from 'jose'
import { beforeAll, describe, expect, it } from 'vitest'

import { InvalidCredentialsError } from '../errors.js'
import type { JsonWebKeySet, SupabaseEnv } from '../types.js'
import { verifyUserAuth } from './verify-user-auth.js'

function makeEnv(overrides?: Partial<SupabaseEnv>): Partial<SupabaseEnv> {
  return {
    url: 'https://test.supabase.co',
    publishableKeys: { default: 'sb_publishable_xyz' },
    secretKeys: {},
    jwks: null,
    ...overrides,
  }
}

describe('verifyUserAuth', () => {
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

  it('succeeds with an authenticated user token without secret keys', async () => {
    const token = await makeToken()
    const req = new Request('http://localhost', {
      headers: { Authorization: `Bearer ${token}` },
    })

    const result = await verifyUserAuth(req, {
      env: makeEnv({ jwks }),
    })

    expect(result.error).toBeNull()
    expect(result.data!.token).toBe(token)
    expect(result.data!.userClaims.id).toBe('user-123')
    expect(result.data!.jwtClaims.aud).toBe('authenticated')
  })

  it('validates the expected user ID', async () => {
    const token = await makeToken()
    const req = new Request('http://localhost', {
      headers: { Authorization: `Bearer ${token}` },
    })

    const result = await verifyUserAuth(req, {
      userId: 'user-123',
      env: makeEnv({ jwks }),
    })

    expect(result.error).toBeNull()
    expect(result.data!.userClaims.id).toBe('user-123')
  })

  it('rejects a token for a different user ID', async () => {
    const token = await makeToken()
    const req = new Request('http://localhost', {
      headers: { Authorization: `Bearer ${token}` },
    })

    const result = await verifyUserAuth(req, {
      userId: 'user-456',
      env: makeEnv({ jwks }),
    })

    expect(result.error).not.toBeNull()
    expect(result.error!.code).toBe(InvalidCredentialsError)
  })

  it('requires authenticated audience by default', async () => {
    const token = await makeToken({ aud: 'anon' })
    const req = new Request('http://localhost', {
      headers: { Authorization: `Bearer ${token}` },
    })

    const result = await verifyUserAuth(req, {
      env: makeEnv({ jwks }),
    })

    expect(result.error).not.toBeNull()
    expect(result.error!.code).toBe(InvalidCredentialsError)
  })

  it('allows custom expected audiences', async () => {
    const token = await makeToken({ aud: 'custom' })
    const req = new Request('http://localhost', {
      headers: { Authorization: `Bearer ${token}` },
    })

    const result = await verifyUserAuth(req, {
      audience: 'custom',
      env: makeEnv({ jwks }),
    })

    expect(result.error).toBeNull()
  })
})
