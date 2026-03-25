import { afterEach, describe, expect, it, vi } from 'vitest'

import { resolveEnv } from './resolve-env.js'
import { MissingSupabaseURLError } from '../errors.js'

describe('resolveEnv', () => {
  afterEach(() => {
    vi.unstubAllEnvs()
  })

  it('returns error when SUPABASE_URL is missing', () => {
    const result = resolveEnv()
    expect(result.error).not.toBeNull()
    expect(result.error!.code).toBe(MissingSupabaseURLError)
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

  it('wraps bare JWKS array in { keys } object', () => {
    vi.stubEnv('SUPABASE_URL', 'https://test.supabase.co')
    const keys = [{ kty: 'EC', crv: 'P-256', x: 'test', y: 'test' }]
    vi.stubEnv('SUPABASE_JWKS', JSON.stringify(keys))
    const result = resolveEnv()
    expect(result.data!.jwks).toEqual({ keys })
  })

  it('returns null jwks for invalid JSON', () => {
    vi.stubEnv('SUPABASE_URL', 'https://test.supabase.co')
    vi.stubEnv('SUPABASE_JWKS', 'not-json')
    const result = resolveEnv()
    expect(result.data!.jwks).toBeNull()
  })

  it.each([
    ['a primitive', '1'],
    ['an empty object', '{}'],
    ['an object with non-array keys', '{"keys":"nope"}'],
    ['a string', '"hello"'],
    ['null', 'null'],
    ['a boolean', 'true'],
  ])('returns null jwks for valid JSON that is %s', (_label, value) => {
    vi.stubEnv('SUPABASE_URL', 'https://test.supabase.co')
    vi.stubEnv('SUPABASE_JWKS', value)
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

  it('parses platform env vars with multiple keys and JWKS array', () => {
    vi.stubEnv('SUPABASE_URL', 'https://test.supabase.co')
    vi.stubEnv(
      'SUPABASE_PUBLISHABLE_KEYS',
      '{"default":"sb_publishable_fake_default_key","test":"sb_publishable_fake_test_key"}',
    )
    vi.stubEnv(
      'SUPABASE_SECRET_KEYS',
      '{"default":"sb_secret_fake_default_key_val","internal":"sb_secret_fake_internal_key"}',
    )
    vi.stubEnv(
      'SUPABASE_JWKS',
      '[{"x":"aN7ek2W_m0BCBoy2vnfwd_785kEfMCcAMGznUg3ut34","y":"7vftLMpD-fRUFmhrqOIfS6ApmCzKgbE6dFsP4o5BCso","alg":"ES256","crv":"P-256","ext":true,"kid":"cb770052-bdd3-4f5e-8d6f-8836046b7c93","kty":"EC","key_ops":["verify"]},{"x":"vwGP-KLJgwv0LHlZEd-7AksGdnznPFcodh4kEKjWUV0","y":"hOyozpKPMwFu8iFGC6QJLqOmDdrNTLyBxiWhKoSSg58","alg":"ES256","crv":"P-256","ext":true,"kid":"9a9933f7-e18f-4d6f-a791-9a992845a27b","kty":"EC","key_ops":["verify"]}]',
    )
    const result = resolveEnv()
    expect(result.error).toBeNull()
    expect(result.data!.publishableKeys).toEqual({
      default: 'sb_publishable_fake_default_key',
      test: 'sb_publishable_fake_test_key',
    })
    expect(result.data!.secretKeys).toEqual({
      default: 'sb_secret_fake_default_key_val',
      internal: 'sb_secret_fake_internal_key',
    })
    expect(result.data!.jwks!.keys).toHaveLength(2)
    expect((result.data!.jwks!.keys[0] as Record<string, unknown>).kid).toBe(
      'cb770052-bdd3-4f5e-8d6f-8836046b7c93',
    )
    expect((result.data!.jwks!.keys[1] as Record<string, unknown>).kid).toBe(
      '9a9933f7-e18f-4d6f-a791-9a992845a27b',
    )
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
