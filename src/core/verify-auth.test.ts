import { describe, expect, it } from 'vitest'

import { MissingCredentialsError, UnusableCredentialError } from '../errors.js'
import { verifyAuth } from './verify-auth.js'

describe('verifyAuth', () => {
  const env = {
    url: 'https://test.supabase.co',
    publishableKeys: { default: 'sb_publishable_xyz' },
    secretKeys: {},
    jwks: null,
  }

  it('extracts credentials from request and verifies', async () => {
    const req = new Request('http://localhost', {
      headers: { apikey: 'sb_publishable_xyz' },
    })
    const result = await verifyAuth(req, { auth: 'publishable', env })
    expect(result.error).toBeNull()
    expect(result.data!.authMode).toBe('publishable')
  })

  it('fails when credentials do not match', async () => {
    const req = new Request('http://localhost', {
      headers: { apikey: 'wrong' },
    })
    const result = await verifyAuth(req, { auth: 'publishable', env })
    expect(result.error).not.toBeNull()
  })

  // `extractCredentials` only reads `Authorization: Bearer <token>`, so these
  // all produce no credential at all. Without a hint the failure reads as
  // "you sent nothing", which is the most confusing way for auth to fail.
  describe('unusable Authorization header', () => {
    const userEnv = { ...env, jwks: null }

    async function failFor(authorization: string) {
      const req = new Request('http://localhost', {
        headers: { authorization },
      })
      const result = await verifyAuth(req, { auth: 'user', env: userEnv })
      expect(result.error).not.toBeNull()
      return result.error!
    }

    it('explains a non-Bearer scheme', async () => {
      const error = await failFor('Basic dXNlcjpwYXNz')
      // A credential arrived, so this is not MISSING_CREDENTIALS.
      expect(error.code).toBe(UnusableCredentialError)
      expect(error.message).toContain('"Basic"')
      expect(error.message).toContain('not `Bearer`')
      expect(error.hint).toContain('Authorization: Bearer <jwt>')
      expect(error.details!.received).toMatchObject({
        authorization: 'non-bearer-scheme',
      })
    })

    it('explains a lowercased bearer scheme', async () => {
      const error = await failFor('bearer some.jwt.value')
      expect(error.code).toBe(UnusableCredentialError)
      expect(error.message).toContain('"bearer"')
      expect(error.hint).toContain('case-sensitive')
    })

    it('explains a bare token with no scheme', async () => {
      const error = await failFor('some.jwt.value')
      expect(error.code).toBe(UnusableCredentialError)
      expect(error.message).toContain('no scheme')
    })

    it('explains an empty Bearer token', async () => {
      const error = await failFor('Bearer ')
      expect(error.code).toBe(UnusableCredentialError)
      expect(error.message).toContain('empty token')
    })

    it('leaves the error untouched when no Authorization header is sent', async () => {
      const req = new Request('http://localhost')
      const result = await verifyAuth(req, { auth: 'user', env: userEnv })
      expect(result.error!.code).toBe(MissingCredentialsError)
      expect(result.error!.details!.received).toMatchObject({
        authorization: 'absent',
      })
    })
  })
})
