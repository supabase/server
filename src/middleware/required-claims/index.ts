import { defineMiddleware } from '@supabase/middleware'
import type { Middleware } from '@supabase/middleware'
import type { JSONWebKeySet } from 'jose'

import { extractCredentials } from '../../core/extract-credentials.js'
import { resolveJwks } from '../../core/resolve-env.js'
import { classifyApiKey } from '../../core/utils/classify-credentials.js'
import { verifyUserJwt } from '../../core/verify-user-jwt.js'
import { errorResponse } from '../../error-response.js'
import {
  Errors,
  InvalidJwtError,
  JwksFetchFailedError,
  JwksNotConfiguredError,
  MissingCredentialsError,
} from '../../errors.js'
import type { JWTClaims } from '../../types.js'

/**
 * Configuration for {@link withRequiredClaims}.
 *
 * @category Middleware
 */
export interface WithRequiredClaimsConfig {
  /**
   * JWKS source used to verify tokens: an inline key set or a remote JWKS
   * URL. Defaults to `SUPABASE_JWKS` (inline JSON) or `SUPABASE_JWKS_URL`
   * (https endpoint) from the environment.
   */
  jwks?: JSONWebKeySet | URL
}

/**
 * The user-mode auth gate: requires a valid user JWT and contributes
 * **non-null** `ctx.jwtClaims`. Verification runs against the project JWKS,
 * the same core `withSupabase` uses for its `user` auth mode.
 *
 * This is the required-caller counterpart to `withClaims`, which contributes
 * claims when a token is present and lets token-less requests proceed as
 * anonymous. A pipeline picks one or the other, "claims required" or "claims
 * if present"; composing both is a compile-time conflict on the `jwtClaims`
 * key.
 *
 * Behavior:
 * - No `Authorization: Bearer` token (or an `sb_*` API key in that position,
 *   which is an API key rather than a user JWT) → short-circuits with a
 *   401 JSON response (`{ message, code: 'INVALID_CREDENTIALS' }`, matching
 *   `withSupabase`'s error shape). The handler never runs.
 * - Token present but invalid → the same 401.
 * - Token present but no JWKS configured → short-circuits with a 500;
 *   verification is not optional and there is no decode-only mode.
 *
 * Because the contribution is non-null, gated handlers read `ctx.jwtClaims`
 * directly, with no `?.sub ?? 'anon'` fallbacks. Downstream entries declaring
 * a `jwtClaims` prerequisite, such as `withPostgresClient`, compose with no
 * further verification.
 *
 * The 401 and 500 short-circuits carry no CORS headers, and a bare pipeline
 * answers no `OPTIONS` preflight. For browser callers, compose `withCors`
 * (`@supabase/middleware/cors`) ahead of the gate: it answers preflight before
 * the gate runs and stamps `Access-Control-*` headers on the short-circuit
 * responses.
 *
 * Inside `withSupabase` the context already carries verified `jwtClaims`, so
 * this gate is unnecessary there and composing it through the `middleware`
 * option is a compile-time conflict. Use `withSupabase({ auth: 'user' })` to
 * gate that path.
 *
 * @example Gated standalone pipeline
 * ```ts
 * import { pipeline } from '@supabase/middleware'
 * import { withRequiredClaims } from '@supabase/server/middleware/required-claims'
 * import { withPostgresClient } from '@supabase/server/middleware/postgres'
 *
 * export default {
 *   fetch: pipeline([withRequiredClaims(), withPostgresClient()], async (req, ctx) => {
 *     const rows = await ctx.postgres.query`select id, title from posts`
 *     return Response.json({ rows, caller: ctx.jwtClaims.sub })
 *   }),
 * }
 * ```
 *
 * @category Middleware
 */
export const withRequiredClaims: Middleware<
  'jwtClaims',
  WithRequiredClaimsConfig | void,
  Record<never, never>,
  JWTClaims
> = defineMiddleware<
  'jwtClaims',
  WithRequiredClaimsConfig | void,
  Record<never, never>,
  JWTClaims
>({
  key: 'jwtClaims',
  run: (config) => async (req) => {
    const { token } = extractCredentials(req)
    // `sb_*` secrets ride the Authorization header alongside the apikey
    // header — they are API keys, not user JWTs, so they cannot pass a gate
    // that requires verified user claims.
    if (!token || token.startsWith('sb_')) {
      const { apikey } = extractCredentials(req)
      return errorResponse(
        Errors[MissingCredentialsError]({
          authModes: ['user'],
          received: {
            // An `sb_*` value in Authorization is an API key, not a JWT — the
            // header arrived, but carried nothing this gate can verify.
            authorization: token ? 'api-key' : 'absent',
            apikey: classifyApiKey(apikey),
          },
        }),
      )
    }

    const jwks = config?.jwks ?? resolveJwks()
    if (!jwks) {
      return errorResponse(
        Errors[JwksNotConfiguredError]({ middleware: 'withRequiredClaims' }),
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
