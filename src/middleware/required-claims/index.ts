import { defineMiddleware } from '@supabase/middleware'
import type { Middleware } from '@supabase/middleware'
import type { JSONWebKeySet } from 'jose'

import { extractCredentials } from '../../core/extract-credentials.js'
import { resolveJwks } from '../../core/resolve-env.js'
import {
  ApiKeyInAuthorizationHeader,
  diagnoseAuthorizationHeader,
} from '../../core/utils/authorization-header.js'
import { classifyApiKey } from '../../core/utils/classify-credentials.js'
import { verifyUserJwt } from '../../core/verify-user-jwt.js'
import { errorResponse } from '../../error-response.js'
import {
  Errors,
  InvalidJwtError,
  JwksFetchFailedError,
  JwksNotConfiguredError,
  MissingCredentialsError,
  UnusableCredentialError,
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
 * Behavior — every short-circuit uses the standard error payload, with the same
 * code `withSupabase({ auth: 'user' })` returns for an identical request:
 * - No `Authorization: Bearer` token → 401 `MISSING_CREDENTIALS`. The handler
 *   never runs.
 * - An `sb_*` API key in that position → 401 `UNUSABLE_CREDENTIAL`: a
 *   credential arrived, just not a user JWT.
 * - Token present but invalid → 401 `INVALID_JWT`, naming the specific reason.
 * - Token present but no JWKS configured → 500 `JWKS_NOT_CONFIGURED`;
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
    const { token, apikey } = extractCredentials(req)
    // Classified through the shared helper so an identical request gets an
    // identical code here and from `withSupabase({ auth: 'user' })`. A
    // credential that arrived but can't be used is not "missing" — and with
    // `errors: { detailed: false }` the code is all the caller gets.
    const diagnosis = diagnoseAuthorizationHeader(
      req.headers.get('authorization'),
    )
    if (diagnosis.kind !== 'bearer' || !token) {
      const received = {
        authorization:
          diagnosis.kind === 'unreadable'
            ? ('non-bearer-scheme' as const)
            : diagnosis.kind === 'api-key'
              ? ('api-key' as const)
              : ('absent' as const),
        apikey: classifyApiKey(apikey),
      }
      return errorResponse(
        diagnosis.kind === 'absent'
          ? Errors[MissingCredentialsError]({ authModes: ['user'], received })
          : Errors[UnusableCredentialError]({
              authModes: ['user'],
              received,
              ...(diagnosis.kind === 'unreadable'
                ? { reason: diagnosis.reason, hint: diagnosis.hint }
                : ApiKeyInAuthorizationHeader),
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
