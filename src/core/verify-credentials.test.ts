import { exportJWK, generateKeyPair, SignJWT } from 'jose'
import { beforeAll, describe, expect, it } from 'vitest'

import type { Credentials, JsonWebKeySet, SupabaseEnv } from '../types.js'
import { verifyCredentials } from './verify-credentials.js'

function makeEnv(overrides?: Partial<SupabaseEnv>): Partial<SupabaseEnv> {
  return {
    url: 'https://test.supabase.co',
    publishableKeys: [{ name: 'default', key: 'pk_test_key' }],
    secretKeys: [{ name: 'default', key: 'sk_test_secret' }],
    jwks: null,
    ...overrides,
  }
}

describe('verifyCredentials', () => {
  describe('always mode', () => {
    it('succeeds with no credentials', async () => {
      const creds: Credentials = { token: null, apikey: null }
      const result = await verifyCredentials(creds, {
        allow: 'always',
        env: makeEnv(),
      })
      expect(result.error).toBeNull()
      expect(result.data!.authType).toBe('always')
    })
  })

  describe('public mode', () => {
    it('succeeds with valid publishable key', async () => {
      const creds: Credentials = { token: null, apikey: 'pk_test_key' }
      const result = await verifyCredentials(creds, {
        allow: 'public',
        env: makeEnv(),
      })
      expect(result.error).toBeNull()
      expect(result.data!.authType).toBe('public')
    })

    it('fails with invalid key', async () => {
      const creds: Credentials = { token: null, apikey: 'wrong_key' }
      const result = await verifyCredentials(creds, {
        allow: 'public',
        env: makeEnv(),
      })
      expect(result.error).not.toBeNull()
      expect(result.error!.code).toBe('INVALID_CREDENTIALS')
    })

    it('matches named key with colon syntax', async () => {
      const env = makeEnv({
        publishableKeys: [
          { name: 'web', key: 'pk_web' },
          { name: 'mobile', key: 'pk_mobile' },
        ],
      })
      const creds: Credentials = { token: null, apikey: 'pk_web' }
      const result = await verifyCredentials(creds, {
        allow: 'public:web',
        env,
      })
      expect(result.error).toBeNull()
    })

    it('rejects wrong named key', async () => {
      const env = makeEnv({
        publishableKeys: [
          { name: 'web', key: 'pk_web' },
          { name: 'mobile', key: 'pk_mobile' },
        ],
      })
      const creds: Credentials = { token: null, apikey: 'pk_mobile' }
      const result = await verifyCredentials(creds, {
        allow: 'public:web',
        env,
      })
      expect(result.error).not.toBeNull()
    })
  })

  describe('secret mode', () => {
    it('succeeds with valid secret key', async () => {
      const creds: Credentials = { token: null, apikey: 'sk_test_secret' }
      const result = await verifyCredentials(creds, {
        allow: 'secret',
        env: makeEnv(),
      })
      expect(result.error).toBeNull()
      expect(result.data!.authType).toBe('secret')
    })

    it('fails with invalid secret key', async () => {
      const creds: Credentials = { token: null, apikey: 'wrong_secret' }
      const result = await verifyCredentials(creds, {
        allow: 'secret',
        env: makeEnv(),
      })
      expect(result.error).not.toBeNull()
    })
  })

  describe('user mode', () => {
    let jwks: JsonWebKeySet
    let validToken: string

    beforeAll(async () => {
      const { privateKey, publicKey } = await generateKeyPair('RS256')
      const publicJwk = await exportJWK(publicKey)
      publicJwk.alg = 'RS256'
      publicJwk.use = 'sig'
      jwks = { keys: [publicJwk] }

      validToken = await new SignJWT({
        sub: 'user-123',
        role: 'authenticated',
        email: 'test@example.com',
      })
        .setProtectedHeader({ alg: 'RS256' })
        .setIssuedAt()
        .setExpirationTime('1h')
        .sign(privateKey)
    })

    it('succeeds with valid JWT', async () => {
      const creds: Credentials = { token: validToken, apikey: null }
      const result = await verifyCredentials(creds, {
        allow: 'user',
        env: makeEnv({ jwks }),
      })
      expect(result.error).toBeNull()
      expect(result.data!.authType).toBe('user')
      expect(result.data!.user!.id).toBe('user-123')
      expect(result.data!.user!.email).toBe('test@example.com')
      expect(result.data!.claims!.sub).toBe('user-123')
      expect(result.data!.token).toBe(validToken)
    })

    it('fails with invalid JWT', async () => {
      const creds: Credentials = { token: 'invalid.jwt.token', apikey: null }
      const result = await verifyCredentials(creds, {
        allow: 'user',
        env: makeEnv({ jwks }),
      })
      expect(result.error).not.toBeNull()
    })

    it('fails with no token', async () => {
      const creds: Credentials = { token: null, apikey: null }
      const result = await verifyCredentials(creds, {
        allow: 'user',
        env: makeEnv({ jwks }),
      })
      expect(result.error).not.toBeNull()
    })

    it('fails with expired JWT', async () => {
      const { privateKey, publicKey } = await generateKeyPair('RS256')
      const publicJwk = await exportJWK(publicKey)
      publicJwk.alg = 'RS256'
      publicJwk.use = 'sig'
      const expiredJwks = { keys: [publicJwk] }

      const expiredToken = await new SignJWT({ sub: 'user-123' })
        .setProtectedHeader({ alg: 'RS256' })
        .setIssuedAt(Math.floor(Date.now() / 1000) - 7200)
        .setExpirationTime(Math.floor(Date.now() / 1000) - 3600)
        .sign(privateKey)

      const creds: Credentials = { token: expiredToken, apikey: null }
      const result = await verifyCredentials(creds, {
        allow: 'user',
        env: makeEnv({ jwks: expiredJwks }),
      })
      expect(result.error).not.toBeNull()
    })
  })

  describe('array allow (first match wins)', () => {
    it('matches second mode when first fails', async () => {
      const creds: Credentials = { token: null, apikey: 'pk_test_key' }
      const result = await verifyCredentials(creds, {
        allow: ['secret', 'public'],
        env: makeEnv(),
      })
      expect(result.error).toBeNull()
      expect(result.data!.authType).toBe('public')
    })

    it('matches first mode when it succeeds', async () => {
      const creds: Credentials = { token: null, apikey: null }
      const result = await verifyCredentials(creds, {
        allow: ['always', 'public'],
        env: makeEnv(),
      })
      expect(result.data!.authType).toBe('always')
    })
  })
})
