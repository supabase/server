import { defineMiddleware } from '@supabase/middleware'
import type { Middleware } from '@supabase/middleware'

import type { AuthMode, JWTClaims, UserClaims } from '../../types.js'
import type { AuthGateContribution } from './gate.js'

type NeedsAuth = { supabaseAuth: AuthGateContribution }

/** `ctx.userClaims`, read off the gate result. */
export const withUserClaims: Middleware<
  'userClaims',
  void,
  NeedsAuth,
  UserClaims | null
> = defineMiddleware<'userClaims', void, NeedsAuth, UserClaims | null>({
  key: 'userClaims',
  run: () => async (_req, ctx) => ({ userClaims: ctx.supabaseAuth.userClaims }),
})

/** `ctx.jwtClaims`, read off the gate result. */
export const withJwtClaims: Middleware<
  'jwtClaims',
  void,
  NeedsAuth,
  JWTClaims | null
> = defineMiddleware<'jwtClaims', void, NeedsAuth, JWTClaims | null>({
  key: 'jwtClaims',
  run: () => async (_req, ctx) => ({ jwtClaims: ctx.supabaseAuth.jwtClaims }),
})

/** `ctx.authMode`, read off the gate result. */
export const withAuthMode: Middleware<'authMode', void, NeedsAuth, AuthMode> =
  defineMiddleware<'authMode', void, NeedsAuth, AuthMode>({
    key: 'authMode',
    run: () => async (_req, ctx) => ({ authMode: ctx.supabaseAuth.authMode }),
  })

/**
 * `ctx.authKeyName`, read off the gate result. `undefined` for `user` and
 * `none` modes, which match no named key; the client parts read it to mirror
 * the key a `publishable` or `secret` request matched.
 */
export const withAuthKeyName: Middleware<
  'authKeyName',
  void,
  NeedsAuth,
  string | undefined
> = defineMiddleware<'authKeyName', void, NeedsAuth, string | undefined>({
  key: 'authKeyName',
  run: () => async (_req, ctx) => ({
    authKeyName: ctx.supabaseAuth.authKeyName,
  }),
})
