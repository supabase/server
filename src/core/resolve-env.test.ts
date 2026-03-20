import { afterEach, describe, expect, it, vi } from 'vitest'

import { resolveEnv } from './resolve-env.js'

describe('resolveEnv', () => {
  afterEach(() => {
    vi.unstubAllEnvs()
  })

  it('returns error when SUPABASE_URL is missing', () => {
    const result = resolveEnv()
    expect(result.error).not.toBeNull()
    expect(result.error!.code).toBe('MISSING_SUPABASE_URL')
  })

  it('reads SUPABASE_URL from process.env', () => {
    vi.stubEnv('SUPABASE_URL', 'https://test.supabase.co')
    const result = resolveEnv()
    expect(result.error).toBeNull()
    expect(result.data!.url).toBe('https://test.supabase.co')
  })

  it('parses JSON publishable keys', () => {
    vi.stubEnv('SUPABASE_URL', 'https://test.supabase.co')
    vi.stubEnv(
      'SUPABASE_PUBLISHABLE_KEYS',
      JSON.stringify({
        web: 'sb_publishable_abc',
        mobile: 'sb_publishable_def',
      }),
    )
    const result = resolveEnv()
    expect(result.data!.publishableKeys).toEqual({
      web: 'sb_publishable_abc',
      mobile: 'sb_publishable_def',
    })
  })

  it('returns empty object for invalid JSON keys', () => {
    vi.stubEnv('SUPABASE_URL', 'https://test.supabase.co')
    vi.stubEnv('SUPABASE_PUBLISHABLE_KEYS', 'not-json')
    const result = resolveEnv()
    expect(result.data!.publishableKeys).toEqual({})
  })

  it('parses JWKS as JSON', () => {
    vi.stubEnv('SUPABASE_URL', 'https://test.supabase.co')
    const jwks = { keys: [{ kty: 'RSA', n: 'test', e: 'AQAB' }] }
    vi.stubEnv('SUPABASE_JWKS', JSON.stringify(jwks))
    const result = resolveEnv()
    expect(result.data!.jwks).toEqual(jwks)
  })

  it('returns null jwks for invalid JSON', () => {
    vi.stubEnv('SUPABASE_URL', 'https://test.supabase.co')
    vi.stubEnv('SUPABASE_JWKS', 'not-json')
    const result = resolveEnv()
    expect(result.data!.jwks).toBeNull()
  })

  it('reads singular SUPABASE_PUBLISHABLE_KEY as { default: value }', () => {
    vi.stubEnv('SUPABASE_URL', 'https://test.supabase.co')
    vi.stubEnv('SUPABASE_PUBLISHABLE_KEY', 'sb_publishable_test_123')
    const result = resolveEnv()
    expect(result.data!.publishableKeys).toEqual({
      default: 'sb_publishable_test_123',
    })
  })

  it('reads singular SUPABASE_SECRET_KEY as { default: value }', () => {
    vi.stubEnv('SUPABASE_URL', 'https://test.supabase.co')
    vi.stubEnv('SUPABASE_SECRET_KEY', 'sb_secret_test_456')
    const result = resolveEnv()
    expect(result.data!.secretKeys).toEqual({ default: 'sb_secret_test_456' })
  })

  it('prefers plural over singular when both are set', () => {
    vi.stubEnv('SUPABASE_URL', 'https://test.supabase.co')
    vi.stubEnv('SUPABASE_PUBLISHABLE_KEY', 'sb_publishable_singular')
    vi.stubEnv(
      'SUPABASE_PUBLISHABLE_KEYS',
      JSON.stringify({
        web: 'sb_publishable_web',
        mobile: 'sb_publishable_mobile',
      }),
    )
    const result = resolveEnv()
    expect(result.data!.publishableKeys).toEqual({
      web: 'sb_publishable_web',
      mobile: 'sb_publishable_mobile',
    })
  })

  it('uses overrides when provided', () => {
    const result = resolveEnv({
      url: 'https://override.supabase.co',
      publishableKeys: { test: 'sb_publishable_override' },
    })
    expect(result.data!.url).toBe('https://override.supabase.co')
    expect(result.data!.publishableKeys).toEqual({
      test: 'sb_publishable_override',
    })
  })
})
