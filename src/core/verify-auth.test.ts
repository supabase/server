import { describe, expect, it } from 'vitest'

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
})
