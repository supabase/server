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

  it('throws EnvError when publishable keys are empty', () => {
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

  it('uses the named key when keyName is provided', () => {
    const env = {
      url: 'https://test.supabase.co',
      publishableKeys: {
        default: 'sb_publishable_default',
        web: 'sb_publishable_web',
        mobile: 'sb_publishable_mobile',
      },
      secretKeys: { default: 'sb_secret_xyz' },
      jwks: null,
    }
    const client = createContextClient('test-token', env, 'web')
    expect(client).toBeDefined()
  })

  it('throws when named key does not exist', () => {
    expect(() =>
      createContextClient('test-token', validEnv, 'nonexistent'),
    ).toThrow(EnvError)

    try {
      createContextClient('test-token', validEnv, 'nonexistent')
    } catch (e) {
      expect(e).toBeInstanceOf(EnvError)
      expect((e as EnvError).code).toBe('MISSING_PUBLISHABLE_KEY')
    }
  })

  it('falls back to default key when keyName is null', () => {
    const env = {
      url: 'https://test.supabase.co',
      publishableKeys: {
        default: 'sb_publishable_default',
        web: 'sb_publishable_web',
      },
      secretKeys: { default: 'sb_secret_xyz' },
      jwks: null,
    }
    const client = createContextClient('test-token', env, null)
    expect(client).toBeDefined()
  })

  it('falls back to first available key when no default exists and keyName is null', () => {
    const env = {
      url: 'https://test.supabase.co',
      publishableKeys: {
        web: 'sb_publishable_web',
        mobile: 'sb_publishable_mobile',
      },
      secretKeys: { default: 'sb_secret_xyz' },
      jwks: null,
    }
    const client = createContextClient('test-token', env, null)
    expect(client).toBeDefined()
  })

  it('throws when keyName is null and publishable keys are empty', () => {
    const env = {
      url: 'https://test.supabase.co',
      publishableKeys: {},
      secretKeys: { default: 'sb_secret_xyz' },
      jwks: null,
    }
    expect(() => createContextClient('test-token', env, null)).toThrow(EnvError)
  })
})
