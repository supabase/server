import { describe, expectTypeOf, it } from 'vitest'

import type { AuthConfig, WithSupabaseConfig } from './types.js'

/**
 * `AuthConfig` is enforced by `tsc`, not by vitest: the `@ts-expect-error`
 * lines below fail `pnpm typecheck` if the type ever starts accepting an
 * ordering it shouldn't, and fail it just as loudly if it starts rejecting
 * one it should accept (an unused `@ts-expect-error` is itself an error).
 */
describe('AuthConfig', () => {
  it('accepts a single mode unwrapped, keyed or not', () => {
    expectTypeOf<'user'>().toExtend<AuthConfig>()
    expectTypeOf<'secret'>().toExtend<AuthConfig>()
    expectTypeOf<'publishable:mobile'>().toExtend<AuthConfig>()
    expectTypeOf<'secret:*'>().toExtend<AuthConfig>()
  })

  it('accepts the wrapped form of a single mode too', () => {
    const bare: AuthConfig = 'user'
    const wrapped: AuthConfig = ['user']
    void bare
    void wrapped
  })

  it('accepts an ordered list of credentialed modes', () => {
    const ordered: AuthConfig = ['secret', 'user']
    const keyed: AuthConfig = ['user', 'publishable:web_app', 'secret:*']
    void ordered
    void keyed
  })

  it('accepts bare "none", and "none" as the last entry of a list', () => {
    const bare: AuthConfig = 'none'
    const optionalUser: AuthConfig = ['user', 'none']
    const optionalAnything: AuthConfig = ['user', 'secret:*', 'none']
    void bare
    void optionalUser
    void optionalAnything
  })

  it('rejects "none" as a list of one — a bare "none" says the same thing', () => {
    // @ts-expect-error "none" needs a credentialed mode before it
    const only: AuthConfig = ['none']
    void only
  })

  it('rejects modes placed after "none", which can never be reached', () => {
    // @ts-expect-error "none" matches every request, so nothing follows it
    const unreachable: AuthConfig = ['none', 'user']
    void unreachable
    // @ts-expect-error same, with the trailing entry in final position
    const sandwiched: AuthConfig = ['user', 'none', 'secret']
    void sandwiched
  })

  it('rejects a repeated "none"', () => {
    // @ts-expect-error only the last entry may be "none"
    const twice: AuthConfig = ['user', 'none', 'none']
    void twice
  })

  it('is the type of the `auth` option', () => {
    expectTypeOf<WithSupabaseConfig['auth']>().toEqualTypeOf<
      AuthConfig | undefined
    >()
  })
})
