import { describe, expect, it } from 'vitest'

import {
  EnvError,
  MissingDefaultPublishableKeyError,
  MissingPublishableKeyError,
} from '../errors.js'
import { createContextClient } from './create-context-client.js'

const validEnv = {
  url: 'https://test.supabase.co',
  publishableKeys: { default: 'sb_publishable_xyz' },
  secretKeys: { default: 'sb_secret_xyz' },
  jwks: null,
}

describe('createContextClient', () => {
  it('creates client with valid env', () => {
    const client = createContextClient({
      auth: { token: 'test-token' },
      env: validEnv,
    })
    expect(client).toBeDefined()
  })

  it('throws EnvError when SUPABASE_URL is missing', () => {
    expect(() =>
      createContextClient({
        auth: { token: 'test-token' },
        env: {
          url: '',
          publishableKeys: { default: 'sb_publishable_xyz' },
          secretKeys: { default: 'sb_secret_xyz' },
          jwks: null,
        },
      }),
    ).toThrow(EnvError)
  })

  it('throws EnvError when publishable keys are empty', () => {
    expect(() =>
      createContextClient({
        auth: { token: 'test-token' },
        env: {
          url: 'https://test.supabase.co',
          publishableKeys: {},
          secretKeys: { default: 'sb_secret_xyz' },
          jwks: null,
        },
      }),
    ).toThrow(EnvError)

    try {
      createContextClient({
        auth: { token: 'test-token' },
        env: {
          url: 'https://test.supabase.co',
          publishableKeys: {},
          secretKeys: { default: 'sb_secret_xyz' },
          jwks: null,
        },
      })
    } catch (e) {
      expect(e).toBeInstanceOf(EnvError)
      expect((e as EnvError).code).toBe(MissingDefaultPublishableKeyError)
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
    const client = createContextClient({
      auth: { token: 'test-token', keyName: 'web' },
      env,
    })
    expect(client).toBeDefined()
  })

  it('throws when named key does not exist', () => {
    expect(() =>
      createContextClient({
        auth: { token: 'test-token', keyName: 'nonexistent' },
        env: validEnv,
      }),
    ).toThrow(EnvError)

    try {
      createContextClient({
        auth: { token: 'test-token', keyName: 'nonexistent' },
        env: validEnv,
      })
    } catch (e) {
      expect(e).toBeInstanceOf(EnvError)
      expect((e as EnvError).code).toBe(MissingPublishableKeyError)
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
    const client = createContextClient({
      auth: { token: 'test-token', keyName: null },
      env,
    })
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
    const client = createContextClient({
      auth: { token: 'test-token', keyName: null },
      env,
    })
    expect(client).toBeDefined()
  })

  it('throws when keyName is null and publishable keys are empty', () => {
    const env = {
      url: 'https://test.supabase.co',
      publishableKeys: {},
      secretKeys: { default: 'sb_secret_xyz' },
      jwks: null,
    }
    expect(() =>
      createContextClient({
        auth: { token: 'test-token', keyName: null },
        env,
      }),
    ).toThrow(EnvError)
  })

  it('creates client with custom supabaseOptions', () => {
    const client = createContextClient({
      auth: { token: 'test-token' },
      env: validEnv,
      supabaseOptions: { db: { schema: 'api' } },
    })
    expect(client).toBeDefined()
  })

  it('creates client with supabaseOptions without token', () => {
    const client = createContextClient({
      env: validEnv,
      supabaseOptions: { db: { schema: 'api' } },
    })
    expect(client).toBeDefined()
  })
})
