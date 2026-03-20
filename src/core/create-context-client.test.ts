import { describe, expect, it } from 'vitest'

import { EnvError } from '../errors.js'
import { createContextClient } from './create-context-client.js'

const validEnv = {
  url: 'https://test.supabase.co',
  publishableKeys: { default: 'sb_publishable_xyz' },
  secretKeys: { default: 'sb_secret_xyz' },
  jwks: null,
}

describe('createContextClient', () => {
  it('creates client with valid env', () => {
    const client = createContextClient('test-token', validEnv)
    expect(client).toBeDefined()
  })

  it('throws EnvError when SUPABASE_URL is missing', () => {
    expect(() =>
      createContextClient('test-token', {
        url: '',
        publishableKeys: { default: 'sb_publishable_xyz' },
        secretKeys: { default: 'sb_secret_xyz' },
        jwks: null,
      }),
    ).toThrow(EnvError)
  })

  it('throws EnvError when default publishable key is missing', () => {
    expect(() =>
      createContextClient('test-token', {
        url: 'https://test.supabase.co',
        publishableKeys: {},
        secretKeys: { default: 'sb_secret_xyz' },
        jwks: null,
      }),
    ).toThrow(EnvError)

    try {
      createContextClient('test-token', {
        url: 'https://test.supabase.co',
        publishableKeys: {},
        secretKeys: { default: 'sb_secret_xyz' },
        jwks: null,
      })
    } catch (e) {
      expect(e).toBeInstanceOf(EnvError)
      expect((e as EnvError).code).toBe('MISSING_PUBLISHABLE_KEY')
    }
  })
})
