import { describe, expect, expectTypeOf, it } from 'vitest'

import type { AuthMode, SupabaseContext, UpstreamAuth } from '../types.js'
import { readUpstreamAuth } from './read-upstream-auth.js'

describe('readUpstreamAuth', () => {
  it('reads an empty contract when no upstream has run', () => {
    expect(readUpstreamAuth(undefined)).toEqual({})
    expect(readUpstreamAuth(null)).toEqual({})
  })

  it('reads the keys an upstream seeded', () => {
    expect(
      readUpstreamAuth({ authMode: 'publishable', authKeyName: 'web' }),
    ).toEqual({ authMode: 'publishable', authKeyName: 'web' })
  })

  it('tracks SupabaseContext, so renaming a key there breaks the readers', () => {
    expectTypeOf<UpstreamAuth>().toEqualTypeOf<{
      authMode?: AuthMode
      authKeyName?: string
    }>()
    expectTypeOf<UpstreamAuth['authMode']>().toEqualTypeOf<
      SupabaseContext['authMode'] | undefined
    >()
  })

  it('rejects a key the client entries never read', () => {
    const seeded = {
      authMode: 'secret',
      // @ts-expect-error the contract admits only the keys the entries read
      authKeyname: 'cron',
    } satisfies UpstreamAuth

    expect(seeded.authMode).toBe('secret')
  })
})
