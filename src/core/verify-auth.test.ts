import { describe, expect, it } from 'vitest'

import { verifyAuth } from './verify-auth.js'

describe('verifyAuth', () => {
  const env = {
    url: 'https://test.supabase.co',
    publishableKeys: { default: 'pk_test' },
    secretKeys: {},
    jwks: null,
  }

  it('extracts credentials from request and verifies', async () => {
    const req = new Request('http://localhost', {
      headers: { apikey: 'pk_test' },
    })
    const result = await verifyAuth(req, { allow: 'public', env })
    expect(result.error).toBeNull()
    expect(result.data!.authType).toBe('public')
  })

  it('fails when credentials do not match', async () => {
    const req = new Request('http://localhost', {
      headers: { apikey: 'wrong' },
    })
    const result = await verifyAuth(req, { allow: 'public', env })
    expect(result.error).not.toBeNull()
  })
})
