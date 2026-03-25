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
    const client = createAdminClient({ env: validEnv })
    expect(client).toBeDefined()
  })

  it('throws EnvError when SUPABASE_URL is missing', () => {
    expect(() =>
      createAdminClient({
        env: {
          url: '',
          publishableKeys: { default: 'sb_publishable_xyz' },
          secretKeys: { default: 'sb_secret_xyz' },
          jwks: null,
        },
      }),
    ).toThrow(EnvError)
  })

  it('throws EnvError when secret keys are empty', () => {
    expect(() =>
      createAdminClient({
        env: {
          url: 'https://test.supabase.co',
          publishableKeys: { default: 'sb_publishable_xyz' },
          secretKeys: {},
          jwks: null,
        },
      }),
    ).toThrow(EnvError)

    try {
      createAdminClient({
        env: {
          url: 'https://test.supabase.co',
          publishableKeys: { default: 'sb_publishable_xyz' },
          secretKeys: {},
          jwks: null,
        },
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
    const client = createAdminClient({ auth: { keyName: 'web' }, env })
    expect(client).toBeDefined()
  })

  it('throws when named key does not exist', () => {
    expect(() =>
      createAdminClient({ auth: { keyName: 'nonexistent' }, env: validEnv }),
    ).toThrow(EnvError)

    try {
      createAdminClient({ auth: { keyName: 'nonexistent' }, env: validEnv })
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
    const client = createAdminClient({ auth: { keyName: null }, env })
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
    const client = createAdminClient({ auth: { keyName: null }, env })
    expect(client).toBeDefined()
  })

  it('throws when keyName is null and secret keys are empty', () => {
    const env = {
      url: 'https://test.supabase.co',
      publishableKeys: { default: 'sb_publishable_xyz' },
      secretKeys: {},
      jwks: null,
    }
    expect(() => createAdminClient({ auth: { keyName: null }, env })).toThrow(
      EnvError,
    )
  })

  it('creates admin client with custom supabaseOptions', () => {
    const client = createAdminClient({
      env: validEnv,
      supabaseOptions: { db: { schema: 'api' } },
    })
    expect(client).toBeDefined()
  })
})
