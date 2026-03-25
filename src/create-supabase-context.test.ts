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
      allow: 'always',
      env: baseEnv,
    })

    expect(result.error).toBeNull()
    expect(result.data).not.toBeNull()
    expect(result.data!.supabase).toBeDefined()
    expect(result.data!.supabaseAdmin).toBeDefined()
    expect(result.data!.authType).toBe('always')
  })

  it('returns user and claims as null for non-user auth', async () => {
    const req = new Request('http://localhost')
    const result = await createSupabaseContext(req, {
      allow: 'always',
      env: baseEnv,
    })

    expect(result.data!.userClaims).toBeNull()
    expect(result.data!.claims).toBeNull()
  })

  it('returns error when auth fails', async () => {
    const req = new Request('http://localhost')
    const result = await createSupabaseContext(req, {
      allow: 'user',
      env: baseEnv,
    })

    expect(result.data).toBeNull()
    expect(result.error).not.toBeNull()
    expect(result.error!.status).toBe(401)
    expect(result.error!.code).toBeDefined()
  })

  it('defaults to allow: user when no options provided', async () => {
    const req = new Request('http://localhost')
    const result = await createSupabaseContext(req, { env: baseEnv })

    expect(result.data).toBeNull()
    expect(result.error).not.toBeNull()
    expect(result.error!.status).toBe(401)
  })

  it('accepts public key auth', async () => {
    const req = new Request('http://localhost', {
      headers: { apikey: 'sb_publishable_xyz' },
    })
    const result = await createSupabaseContext(req, {
      allow: 'public',
      env: baseEnv,
    })

    expect(result.error).toBeNull()
    expect(result.data!.authType).toBe('public')
    expect(result.data!.supabase).toBeDefined()
    expect(result.data!.supabaseAdmin).toBeDefined()
  })

  it('accepts secret key auth', async () => {
    const req = new Request('http://localhost', {
      headers: { apikey: 'sb_secret_xyz' },
    })
    const result = await createSupabaseContext(req, {
      allow: 'secret',
      env: baseEnv,
    })

    expect(result.error).toBeNull()
    expect(result.data!.authType).toBe('secret')
  })

  it('rejects invalid secret key', async () => {
    const req = new Request('http://localhost', {
      headers: { apikey: 'wrong_key' },
    })
    const result = await createSupabaseContext(req, {
      allow: 'secret',
      env: baseEnv,
    })

    expect(result.data).toBeNull()
    expect(result.error).not.toBeNull()
  })

  it('returns error when client creation fails due to missing keys', async () => {
    const req = new Request('http://localhost')
    const result = await createSupabaseContext(req, {
      allow: 'always',
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
})
