import { defineMiddleware } from '@supabase/middleware'
import type { Middleware } from '@supabase/middleware'
import type { JSONWebKeySet } from 'jose'

import { extractCredentials } from '../../core/extract-credentials.js'
import { resolveJwks } from '../../core/resolve-env.js'
import { verifyUserJwt } from '../../core/verify-user-jwt.js'
import { errorResponse } from '../../error-response.js'
import {
  Errors,
  InvalidJwtError,
  JwksFetchFailedError,
  JwksNotConfiguredError,
} from '../../errors.js'
import type { JWTClaims } from '../../types.js'

/**
 * Configuration for {@link withClaims}.
 *
 * @category Middleware
 */
export interface WithClaimsConfig {
  /**
   * JWKS source used to verify tokens: an inline key set or a remote JWKS
   * URL. Defaults to `SUPABASE_JWKS` (inline JSON) or `SUPABASE_JWKS_URL`
   * (https endpoint) from the environment.
   */
  jwks?: JSONWebKeySet | URL
}

/**
 * Contributes `ctx.jwtClaims` by verifying the caller's Bearer token against
 * the project JWKS — the same verification core `withSupabase` uses for its
 * `user` auth mode.
 *
 * Use this when composing a standalone `pipeline([...], handler)` that is
 * **not** wrapped by `withSupabase` — for example a Supabase-agnostic Edge
 * Function that still wants the caller's verified claims available to a
 * downstream middleware such as `withPostgresClient`. Inside `withSupabase`, the
 * context already carries `jwtClaims`, so `withClaims` is unnecessary.
 *
 * Behavior:
 * - No `Authorization: Bearer` token (or an `sb_*` API key in that position)
 *   → contributes `null`; the request proceeds as anonymous.
 * - Token present but invalid → short-circuits with a 401 JSON response
 *   (`{ message, code }`, matching `withSupabase`'s error shape).
 * - Token present but no JWKS configured → short-circuits with a 500 —
 *   verification is not optional; there is no decode-only mode.
 *
 * `withClaims` is not an auth gate. It never rejects a request that has no
 * token. A pipeline like `[withClaims(), withSupabaseClient()]` accepts
 * anonymous callers and is not the composable form of
 * `withSupabase({ auth: 'user' })`, which rejects token-less requests with
 * a 401. To require an authenticated caller, compose `withRequiredClaims`
 * from `@supabase/server/middleware/required-claims` instead. The two entries
 * share the `jwtClaims` key, so a pipeline picks "claims if present" or
 * "claims required"; composing both is a compile-time conflict.
 *
 * @example Standalone pipeline
 * ```ts
 * import { pipeline } from '@supabase/middleware'
 * import { withClaims } from '@supabase/server/middleware/claims'
 * import { withPostgresClient } from '@supabase/server/middleware/postgres'
 *
 * export default {
 *   fetch: pipeline([withClaims(), withPostgresClient()], async (req, ctx) => {
 *     const rows = await ctx.postgres.query`select id, title from posts`
 *     return Response.json({ rows, caller: ctx.jwtClaims?.sub ?? 'anon' })
 *   }),
 * }
 * ```
 *
 * @category Middleware
 */
export const withClaims: Middleware<
  'jwtClaims',
  WithClaimsConfig | void,
  Record<never, never>,
  JWTClaims | null
> = defineMiddleware<
  'jwtClaims',
  WithClaimsConfig | void,
  Record<never, never>,
  JWTClaims | null
>({
  key: 'jwtClaims',
  run: (config) => async (req) => {
    const { token } = extractCredentials(req)
    // `sb_*` secrets ride the Authorization header alongside the apikey
    // header — they are API keys, not user JWTs.
    if (!token || token.startsWith('sb_')) {
      return { jwtClaims: null }
    }

    const jwks = config?.jwks ?? resolveJwks()
    if (!jwks) {
      return errorResponse(
        Errors[JwksNotConfiguredError]({ middleware: 'withClaims' }),
      )
    }

    const verified = await verifyUserJwt(token, jwks)
    if (!verified.ok) {
      const { failure } = verified
      return errorResponse(
        failure.kind === 'jwks-source'
          ? Errors[JwksFetchFailedError]({
              reason: failure.reason,
              cause: failure.cause,
            })
          : Errors[InvalidJwtError]({
              reason: failure.reason,
              hint: failure.hint,
              jwt: failure.jwt,
              cause: failure.cause,
            }),
      )
    }

    return { jwtClaims: verified.jwtClaims }
  },
})
