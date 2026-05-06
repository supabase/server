import { describe, expect, it } from 'vitest'

import { createSupabaseContext } from './create-supabase-context.js'
import {
  MissingDefaultPublishableKeyError,
  MissingDefaultSecretKeyError,
} from './errors.js'

const baseEnv = {
  url: 'https://test.supabase.co',
  publishableKeys: { default: 'sb_publishable_xyz' },
  secretKeys: { default: 'sb_secret_xyz' },
  jwks: null,
}

describe('createSupabaseContext', () => {
  it('returns context with clients on successful auth', async () => {
    const req = new Request('http://localhost')
    const result = await createSupabaseContext(req, {
      auth: 'none',
      env: baseEnv,
    })

    expect(result.error).toBeNull()
    expect(result.data).not.toBeNull()
    expect(result.data!.supabase).toBeDefined()
    expect(result.data!.supabaseAdmin).toBeDefined()
    expect(result.data!.authMode).toBe('none')
    expect(result.data!.authKeyName).toBeNull()
  })

  it('returns user and claims as null for non-user auth', async () => {
    const req = new Request('http://localhost')
    const result = await createSupabaseContext(req, {
      auth: 'none',
      env: baseEnv,
    })

    expect(result.data!.userClaims).toBeNull()
    expect(result.data!.jwtClaims).toBeNull()
  })

  it('returns error when auth fails', async () => {
    const req = new Request('http://localhost')
    const result = await createSupabaseContext(req, {
      auth: 'user',
      env: baseEnv,
    })

    expect(result.data).toBeNull()
    expect(result.error).not.toBeNull()
    expect(result.error!.status).toBe(401)
    expect(result.error!.code).toBeDefined()
  })

  it('defaults to auth: user when no options provided', async () => {
    const req = new Request('http://localhost')
    const result = await createSupabaseContext(req, { env: baseEnv })

    expect(result.data).toBeNull()
    expect(result.error).not.toBeNull()
    expect(result.error!.status).toBe(401)
  })

  it('accepts publishable key auth', async () => {
    const req = new Request('http://localhost', {
      headers: { apikey: 'sb_publishable_xyz' },
    })
    const result = await createSupabaseContext(req, {
      auth: 'publishable',
      env: baseEnv,
    })

    expect(result.error).toBeNull()
    expect(result.data!.authMode).toBe('publishable')
    expect(result.data!.authKeyName).toBe('default')
    expect(result.data!.supabase).toBeDefined()
    expect(result.data!.supabaseAdmin).toBeDefined()
  })

  it('accepts publishable named key auth', async () => {
    const req = new Request('http://localhost', {
      headers: { apikey: 'sb_publishable_web' },
    })
    const result = await createSupabaseContext(req, {
      auth: 'publishable:web',
      env: {
        ...baseEnv,
        publishableKeys: {
          web: 'sb_publishable_web',
        },
      },
    })

    expect(result.error).toBeNull()
    expect(result.data!.authMode).toBe('publishable')
    expect(result.data!.authKeyName).toBe('web')
    expect(result.data!.supabase).toBeDefined()
    expect(result.data!.supabaseAdmin).toBeDefined()
  })

  it('accepts secret key auth', async () => {
    const req = new Request('http://localhost', {
      headers: { apikey: 'sb_secret_xyz' },
    })
    const result = await createSupabaseContext(req, {
      auth: 'secret',
      env: baseEnv,
    })

    expect(result.error).toBeNull()
    expect(result.data!.authMode).toBe('secret')
    expect(result.data!.authKeyName).toBe('default')
  })

  it('accepts secret named key auth', async () => {
    const req = new Request('http://localhost', {
      headers: { apikey: 'sb_secret_web' },
    })
    const result = await createSupabaseContext(req, {
      auth: 'secret:web',
      env: {
        ...baseEnv,
        secretKeys: {
          web: 'sb_secret_web',
        },
      },
    })

    expect(result.error).toBeNull()
    expect(result.data!.authMode).toBe('secret')
    expect(result.data!.authKeyName).toBe('web')
    expect(result.data!.supabase).toBeDefined()
    expect(result.data!.supabaseAdmin).toBeDefined()
  })

  it('rejects invalid secret key', async () => {
    const req = new Request('http://localhost', {
      headers: { apikey: 'wrong_key' },
    })
    const result = await createSupabaseContext(req, {
      auth: 'secret',
      env: baseEnv,
    })

    expect(result.data).toBeNull()
    expect(result.error).not.toBeNull()
  })

  it('returns error when client creation fails due to missing keys', async () => {
    const req = new Request('http://localhost')
    const result = await createSupabaseContext(req, {
      auth: 'none',
      env: {
        url: 'https://test.supabase.co',
        publishableKeys: {},
        secretKeys: {},
        jwks: null,
      },
    })

    expect(result.data).toBeNull()
    expect(result.error).not.toBeNull()
    expect(result.error!.status).toBe(500)
    expect(result.error!.code).toBeOneOf([
      MissingDefaultPublishableKeyError,
      MissingDefaultSecretKeyError,
    ])
  })

  it('passes supabaseOptions through to clients', async () => {
    const req = new Request('http://localhost')
    const result = await createSupabaseContext(req, {
      auth: 'none',
      env: baseEnv,
      supabaseOptions: { db: { schema: 'api' } },
    })

    expect(result.error).toBeNull()
    expect(result.data).not.toBeNull()
    expect(result.data!.supabase).toBeDefined()
    expect(result.data!.supabaseAdmin).toBeDefined()
  })
})
