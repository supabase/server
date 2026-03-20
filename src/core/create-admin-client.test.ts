import { describe, expect, it } from 'vitest'

import { EnvError } from '../errors.js'
import { createAdminClient } from './create-admin-client.js'

const validEnv = {
  url: 'https://test.supabase.co',
  publishableKeys: { default: 'sb_publishable_xyz' },
  secretKeys: { default: 'sb_secret_xyz' },
  jwks: null,
}

describe('createAdminClient', () => {
  it('creates client with valid env', () => {
    const client = createAdminClient(validEnv)
    expect(client).toBeDefined()
  })

  it('throws EnvError when SUPABASE_URL is missing', () => {
    expect(() =>
      createAdminClient({
        url: '',
        publishableKeys: { default: 'sb_publishable_xyz' },
        secretKeys: { default: 'sb_secret_xyz' },
        jwks: null,
      }),
    ).toThrow(EnvError)
  })

  it('throws EnvError when default secret key is missing', () => {
    expect(() =>
      createAdminClient({
        url: 'https://test.supabase.co',
        publishableKeys: { default: 'sb_publishable_xyz' },
        secretKeys: {},
        jwks: null,
      }),
    ).toThrow(EnvError)

    try {
      createAdminClient({
        url: 'https://test.supabase.co',
        publishableKeys: { default: 'sb_publishable_xyz' },
        secretKeys: {},
        jwks: null,
      })
    } catch (e) {
      expect(e).toBeInstanceOf(EnvError)
      expect((e as EnvError).code).toBe('MISSING_SECRET_KEY')
    }
  })
})
