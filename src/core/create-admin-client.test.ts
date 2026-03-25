import { describe, expect, it } from 'vitest'

import {
  EnvError,
  MissingDefaultSecretKeyError,
  MissingSecretKeyError,
} from '../errors.js'
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

  it('throws EnvError when secret keys are empty', () => {
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
      expect((e as EnvError).code).toBe(MissingDefaultSecretKeyError)
    }
  })

  it('uses the named key when keyName is provided', () => {
    const env = {
      url: 'https://test.supabase.co',
      publishableKeys: { default: 'sb_publishable_xyz' },
      secretKeys: {
        default: 'sb_secret_default',
        web: 'sb_secret_web',
        mobile: 'sb_secret_mobile',
      },
      jwks: null,
    }
    const client = createAdminClient(env, 'web')
    expect(client).toBeDefined()
  })

  it('throws when named key does not exist', () => {
    expect(() => createAdminClient(validEnv, 'nonexistent')).toThrow(EnvError)

    try {
      createAdminClient(validEnv, 'nonexistent')
    } catch (e) {
      expect(e).toBeInstanceOf(EnvError)
      expect((e as EnvError).code).toBe(MissingSecretKeyError)
    }
  })

  it('falls back to default key when keyName is null', () => {
    const env = {
      url: 'https://test.supabase.co',
      publishableKeys: { default: 'sb_publishable_xyz' },
      secretKeys: {
        default: 'sb_secret_default',
        web: 'sb_secret_web',
      },
      jwks: null,
    }
    const client = createAdminClient(env, null)
    expect(client).toBeDefined()
  })

  it('falls back to first available key when no default exists and keyName is null', () => {
    const env = {
      url: 'https://test.supabase.co',
      publishableKeys: { default: 'sb_publishable_xyz' },
      secretKeys: {
        web: 'sb_secret_web',
        mobile: 'sb_secret_mobile',
      },
      jwks: null,
    }
    const client = createAdminClient(env, null)
    expect(client).toBeDefined()
  })

  it('throws when keyName is null and secret keys are empty', () => {
    const env = {
      url: 'https://test.supabase.co',
      publishableKeys: { default: 'sb_publishable_xyz' },
      secretKeys: {},
      jwks: null,
    }
    expect(() => createAdminClient(env, null)).toThrow(EnvError)
  })
})
