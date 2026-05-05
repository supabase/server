import { exportJWK, generateKeyPair, SignJWT } from 'jose'
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

import type { Credentials, JsonWebKeySet, SupabaseEnv } from '../types.js'
import { verifyCredentials } from './verify-credentials.js'
import { _resetAllowDeprecationWarned } from './utils/deprecation.js'
import { InvalidCredentialsError } from '../errors.js'

function makeEnv(overrides?: Partial<SupabaseEnv>): Partial<SupabaseEnv> {
  return {
    url: 'https://test.supabase.co',
    publishableKeys: { default: 'sb_publishable_xyz' },
    secretKeys: { default: 'sb_secret_xyz' },
    jwks: null,
    ...overrides,
  }
}

describe('verifyCredentials', () => {
  describe('always mode', () => {
    it('succeeds with no credentials and keyName is null', async () => {
      const creds: Credentials = { token: null, apikey: null }
      const result = await verifyCredentials(creds, {
        auth: 'always',
        env: makeEnv(),
      })
      expect(result.error).toBeNull()
      expect(result.data!.authType).toBe('always')
      expect(result.data!.keyName).toBeNull()
    })
  })

  describe('public mode', () => {
    it('succeeds with valid publishable key and returns default keyName', async () => {
      const creds: Credentials = {
        token: null,
        apikey: 'sb_publishable_xyz',
      }
      const result = await verifyCredentials(creds, {
        auth: 'public',
        env: makeEnv(),
      })
      expect(result.error).toBeNull()
      expect(result.data!.authType).toBe('public')
      expect(result.data!.keyName).toBe('default')
    })

    it('fails with invalid key', async () => {
      const creds: Credentials = { token: null, apikey: 'wrong_key' }
      const result = await verifyCredentials(creds, {
        auth: 'public',
        env: makeEnv(),
      })
      expect(result.error).not.toBeNull()
      expect(result.error!.code).toBe(InvalidCredentialsError)
    })

    it('only matches default key when bare public is used', async () => {
      const env = makeEnv({
        publishableKeys: {
          default: 'sb_publishable_default',
          web: 'sb_publishable_web',
        },
      })
      const creds: Credentials = { token: null, apikey: 'sb_publishable_web' }
      const result = await verifyCredentials(creds, {
        auth: 'public',
        env,
      })
      expect(result.error).not.toBeNull()
      expect(result.error!.code).toBe(InvalidCredentialsError)
    })

    it('matches named key with colon syntax and returns keyName', async () => {
      const env = makeEnv({
        publishableKeys: {
          web: 'sb_publishable_web',
          mobile: 'sb_publishable_mobile',
        },
      })
      const creds: Credentials = { token: null, apikey: 'sb_publishable_web' }
      const result = await verifyCredentials(creds, {
        auth: 'public:web',
        env,
      })
      expect(result.error).toBeNull()
      expect(result.data!.keyName).toBe('web')
    })

    it('rejects wrong named key', async () => {
      const env = makeEnv({
        publishableKeys: {
          web: 'sb_publishable_web',
          mobile: 'sb_publishable_mobile',
        },
      })
      const creds: Credentials = {
        token: null,
        apikey: 'sb_publishable_mobile',
      }
      const result = await verifyCredentials(creds, {
        auth: 'public:web',
        env,
      })
      expect(result.error).not.toBeNull()
      expect(result.error!.code).toBe(InvalidCredentialsError)
    })

    it('rejects wrong named key type', async () => {
      const env = makeEnv({
        publishableKeys: {
          web: 'sb_publishable_web',
          mobile: 'sb_publishable_mobile',
        },
      })
      const creds: Credentials = { token: null, apikey: 'sb_publishable_web' }
      const result = await verifyCredentials(creds, {
        auth: 'secret:web',
        env,
      })
      expect(result.error).not.toBeNull()
      expect(result.error!.code).toBe(InvalidCredentialsError)
    })

    it('matches any key with wildcard syntax', async () => {
      const env = makeEnv({
        publishableKeys: {
          web: 'sb_publishable_web',
          mobile: 'sb_publishable_mobile',
        },
      })
      const creds: Credentials = {
        token: null,
        apikey: 'sb_publishable_mobile',
      }
      const result = await verifyCredentials(creds, {
        auth: 'public:*',
        env,
      })
      expect(result.error).toBeNull()
      expect(result.data!.authType).toBe('public')
    })

    it('wildcard returns correct keyName for non-first key', async () => {
      const env = makeEnv({
        publishableKeys: {
          default: 'sb_publishable_default',
          web: 'sb_publishable_web',
          mobile: 'sb_publishable_mobile',
        },
      })
      const creds: Credentials = {
        token: null,
        apikey: 'sb_publishable_mobile',
      }
      const result = await verifyCredentials(creds, {
        auth: 'public:*',
        env,
      })
      expect(result.error).toBeNull()
      expect(result.data!.keyName).toBe('mobile')
    })
  })

  describe('secret mode', () => {
    it('succeeds with valid secret key and returns default keyName', async () => {
      const creds: Credentials = { token: null, apikey: 'sb_secret_xyz' }
      const result = await verifyCredentials(creds, {
        auth: 'secret',
        env: makeEnv(),
      })
      expect(result.error).toBeNull()
      expect(result.data!.authType).toBe('secret')
      expect(result.data!.keyName).toBe('default')
    })

    it('fails with invalid secret key', async () => {
      const creds: Credentials = { token: null, apikey: 'wrong_secret' }
      const result = await verifyCredentials(creds, {
        auth: 'secret',
        env: makeEnv(),
      })
      expect(result.error).not.toBeNull()
      expect(result.error!.code).toBe(InvalidCredentialsError)
    })

    it('only matches default key when bare secret is used', async () => {
      const env = makeEnv({
        secretKeys: { default: 'sb_secret_default', web: 'sb_secret_web' },
      })
      const creds: Credentials = { token: null, apikey: 'sb_secret_web' }
      const result = await verifyCredentials(creds, {
        auth: 'secret',
        env,
      })
      expect(result.error).not.toBeNull()
      expect(result.error!.code).toBe(InvalidCredentialsError)
    })

    it('matches secret named key with colon syntax and returns keyName', async () => {
      const env = makeEnv({
        secretKeys: { web: 'sb_secret_web', mobile: 'sb_secret_mobile' },
      })
      const creds: Credentials = { token: null, apikey: 'sb_secret_web' }
      const result = await verifyCredentials(creds, {
        auth: 'secret:web',
        env,
      })
      expect(result.error).toBeNull()
      expect(result.data!.keyName).toBe('web')
    })

    it('rejects wrong secret named key', async () => {
      const env = makeEnv({
        secretKeys: { web: 'sb_secret_web', mobile: 'sb_secret_mobile' },
      })
      const creds: Credentials = { token: null, apikey: 'sb_secret_mobile' }
      const result = await verifyCredentials(creds, {
        auth: 'secret:web',
        env,
      })
      expect(result.error).not.toBeNull()
      expect(result.error!.code).toBe(InvalidCredentialsError)
    })

    it('rejects wrong secret named key type', async () => {
      const env = makeEnv({
        secretKeys: { web: 'sb_secret_web', mobile: 'sb_secret_mobile' },
      })
      const creds: Credentials = { token: null, apikey: 'sb_secret_web' }
      const result = await verifyCredentials(creds, {
        auth: 'public:web',
        env,
      })
      expect(result.error).not.toBeNull()
      expect(result.error!.code).toBe(InvalidCredentialsError)
    })

    it('matches any key with wildcard syntax', async () => {
      const env = makeEnv({
        secretKeys: { web: 'sb_secret_web', mobile: 'sb_secret_mobile' },
      })
      const creds: Credentials = { token: null, apikey: 'sb_secret_mobile' }
      const result = await verifyCredentials(creds, {
        auth: 'secret:*',
        env,
      })
      expect(result.error).toBeNull()
      expect(result.data!.authType).toBe('secret')
    })

    it('wildcard returns correct keyName for non-first key', async () => {
      const env = makeEnv({
        secretKeys: {
          default: 'sb_secret_default',
          web: 'sb_secret_web',
          mobile: 'sb_secret_mobile',
        },
      })
      const creds: Credentials = { token: null, apikey: 'sb_secret_mobile' }
      const result = await verifyCredentials(creds, {
        auth: 'secret:*',
        env,
      })
      expect(result.error).toBeNull()
      expect(result.data!.keyName).toBe('mobile')
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
        auth: 'user',
        env: makeEnv({ jwks }),
      })
      expect(result.error).toBeNull()
      expect(result.data!.authType).toBe('user')
      expect(result.data!.keyName).toBeNull()
      expect(result.data!.userClaims!.id).toBe('user-123')
      expect(result.data!.userClaims!.email).toBe('test@example.com')
      expect(result.data!.claims!.sub).toBe('user-123')
      expect(result.data!.token).toBe(validToken)
    })

    it('fails with invalid JWT', async () => {
      const creds: Credentials = { token: 'invalid.jwt.token', apikey: null }
      const result = await verifyCredentials(creds, {
        auth: 'user',
        env: makeEnv({ jwks }),
      })
      expect(result.error).not.toBeNull()
      expect(result.error!.code).toBe(InvalidCredentialsError)
    })

    it('fails with no token', async () => {
      const creds: Credentials = { token: null, apikey: null }
      const result = await verifyCredentials(creds, {
        auth: 'user',
        env: makeEnv({ jwks }),
      })
      expect(result.error).not.toBeNull()
      expect(result.error!.code).toBe(InvalidCredentialsError)
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
        auth: 'user',
        env: makeEnv({ jwks: expiredJwks }),
      })
      expect(result.error).not.toBeNull()
      expect(result.error!.code).toBe(InvalidCredentialsError)
    })
  })

  describe('parseAuthMode edge cases', () => {
    it('treats trailing colon as bare mode (default key)', async () => {
      const creds: Credentials = {
        token: null,
        apikey: 'sb_publishable_xyz',
      }
      const result = await verifyCredentials(creds, {
        auth: 'public:' as 'public',
        env: makeEnv(),
      })
      expect(result.error).toBeNull()
      expect(result.data!.authType).toBe('public')
    })

    it('treats multiple colons as part of key name', async () => {
      const env = makeEnv({
        publishableKeys: { 'key:extra': 'sb_publishable_colon' },
      })
      const creds: Credentials = {
        token: null,
        apikey: 'sb_publishable_colon',
      }
      const result = await verifyCredentials(creds, {
        auth: 'public:key:extra' as 'public',
        env,
      })
      expect(result.error).toBeNull()
      expect(result.data!.authType).toBe('public')
    })

    it('fails wildcard with empty key object', async () => {
      const env = makeEnv({ publishableKeys: {} })
      const creds: Credentials = {
        token: null,
        apikey: 'sb_publishable_xyz',
      }
      const result = await verifyCredentials(creds, {
        auth: 'public:*' as 'public',
        env,
      })
      expect(result.error).not.toBeNull()
      expect(result.error!.code).toBe(InvalidCredentialsError)
    })
  })

  describe('array auth (first match wins)', () => {
    it('matches second mode when first fails and returns its keyName', async () => {
      const creds: Credentials = {
        token: null,
        apikey: 'sb_publishable_xyz',
      }
      const result = await verifyCredentials(creds, {
        auth: ['secret', 'public'],
        env: makeEnv(),
      })
      expect(result.error).toBeNull()
      expect(result.data!.authType).toBe('public')
      expect(result.data!.keyName).toBe('default')
    })

    it('matches first mode when it succeeds', async () => {
      const creds: Credentials = { token: null, apikey: null }
      const result = await verifyCredentials(creds, {
        auth: ['always', 'public'],
        env: makeEnv(),
      })
      expect(result.error).toBeNull()
      expect(result.data!.authType).toBe('always')
    })
  })

  describe('invalid credential rejection (no silent fallthrough)', () => {
    let jwks: JsonWebKeySet

    beforeAll(async () => {
      const { publicKey } = await generateKeyPair('RS256')
      const publicJwk = await exportJWK(publicKey)
      publicJwk.alg = 'RS256'
      publicJwk.use = 'sig'
      jwks = { keys: [publicJwk] }
    })

    it('rejects invalid JWT instead of falling through to always mode', async () => {
      const creds: Credentials = { token: 'garbage.jwt.token', apikey: null }
      const result = await verifyCredentials(creds, {
        auth: ['user', 'always'],
        env: makeEnv({ jwks }),
      })
      expect(result.error).not.toBeNull()
      expect(result.error!.code).toBe(InvalidCredentialsError)
    })

    it('rejects expired JWT instead of falling through to always mode', async () => {
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
        auth: ['user', 'always'],
        env: makeEnv({ jwks: expiredJwks }),
      })
      expect(result.error).not.toBeNull()
      expect(result.error!.code).toBe(InvalidCredentialsError)
    })

    it('falls through to always when no token is present', async () => {
      const creds: Credentials = { token: null, apikey: null }
      const result = await verifyCredentials(creds, {
        auth: ['user', 'always'],
        env: makeEnv({ jwks }),
      })
      expect(result.error).toBeNull()
      expect(result.data!.authType).toBe('always')
    })

    it('rejects invalid JWT even when public mode follows', async () => {
      const creds: Credentials = {
        token: 'garbage.jwt.token',
        apikey: 'sb_publishable_xyz',
      }
      const result = await verifyCredentials(creds, {
        auth: ['user', 'public'],
        env: makeEnv({ jwks }),
      })
      expect(result.error).not.toBeNull()
      expect(result.error!.code).toBe(InvalidCredentialsError)
    })

    it('rejects invalid JWT instead of falling through to secret mode', async () => {
      const creds: Credentials = {
        token: 'garbage.jwt.token',
        apikey: 'sb_secret_xyz',
      }
      const result = await verifyCredentials(creds, {
        auth: ['user', 'secret'],
        env: makeEnv({ jwks }),
      })
      expect(result.error).not.toBeNull()
      expect(result.error!.code).toBe(InvalidCredentialsError)
    })

    it('rejects JWT with missing sub claim', async () => {
      const { privateKey, publicKey } = await generateKeyPair('RS256')
      const publicJwk = await exportJWK(publicKey)
      publicJwk.alg = 'RS256'
      publicJwk.use = 'sig'
      const noSubJwks = { keys: [publicJwk] }

      const noSubToken = await new SignJWT({ role: 'authenticated' })
        .setProtectedHeader({ alg: 'RS256' })
        .setIssuedAt()
        .setExpirationTime('1h')
        .sign(privateKey)

      const creds: Credentials = { token: noSubToken, apikey: null }
      const result = await verifyCredentials(creds, {
        auth: 'user',
        env: makeEnv({ jwks: noSubJwks }),
      })
      expect(result.error).not.toBeNull()
      expect(result.error!.code).toBe(InvalidCredentialsError)
    })
  })

  describe('allow → auth deprecation', () => {
    beforeEach(() => {
      _resetAllowDeprecationWarned()
    })

    it('still accepts the deprecated `allow` option', async () => {
      const creds: Credentials = { token: null, apikey: null }
      const result = await verifyCredentials(creds, {
        allow: 'always',
        env: makeEnv(),
      })
      expect(result.error).toBeNull()
      expect(result.data!.authType).toBe('always')
    })

    it('emits a deprecation warning when `allow` is used', async () => {
      const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
      const creds: Credentials = { token: null, apikey: null }
      await verifyCredentials(creds, {
        allow: 'always',
        env: makeEnv(),
      })
      expect(warn).toHaveBeenCalledTimes(1)
      const message = warn.mock.calls[0]![0] as string
      expect(message).toContain('@supabase/server')
      expect(message).toContain('`allow`')
      expect(message).toContain('`auth`')
      warn.mockRestore()
    })

    it('only warns once across multiple calls', async () => {
      const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
      const creds: Credentials = { token: null, apikey: null }
      await verifyCredentials(creds, { allow: 'always', env: makeEnv() })
      await verifyCredentials(creds, { allow: 'always', env: makeEnv() })
      await verifyCredentials(creds, { allow: 'always', env: makeEnv() })
      expect(warn).toHaveBeenCalledTimes(1)
      warn.mockRestore()
    })

    it('does not warn when `auth` is used', async () => {
      const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
      const creds: Credentials = { token: null, apikey: null }
      await verifyCredentials(creds, { auth: 'always', env: makeEnv() })
      expect(warn).not.toHaveBeenCalled()
      warn.mockRestore()
    })

    it('prefers `auth` over `allow` when both are provided', async () => {
      const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
      const creds: Credentials = { token: null, apikey: 'sb_secret_xyz' }
      const result = await verifyCredentials(creds, {
        // `auth` should win and the secret key should match.
        auth: 'secret',
        // `allow` would have rejected the secret key (public mode).
        allow: 'public',
        env: makeEnv(),
      })
      expect(result.error).toBeNull()
      expect(result.data!.authType).toBe('secret')
      // No warning since `auth` is the operative option.
      expect(warn).not.toHaveBeenCalled()
      warn.mockRestore()
    })

    it('defaults to `user` when neither `auth` nor `allow` is provided', async () => {
      const creds: Credentials = { token: null, apikey: null }
      const result = await verifyCredentials(creds, { env: makeEnv() })
      // No token, no apikey, default mode is `user` → fails with invalid credentials.
      expect(result.error).not.toBeNull()
      expect(result.error!.code).toBe(InvalidCredentialsError)
    })
  })
})
