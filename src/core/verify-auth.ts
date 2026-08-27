import { withExtraDiagnostics, type AuthError } from '../errors.js'
import type { AuthModeWithKey, AuthResult, SupabaseEnv } from '../types.js'
import { extractCredentials } from './extract-credentials.js'
import { verifyCredentials } from './verify-credentials.js'

/**
 * Options for {@link verifyAuth}.
 * @category Primitives
 */
export interface VerifyAuthOptions {
  /**
   * Auth mode(s) to try. Modes are attempted in order — the first match wins.
   *
   * @see {@link AuthModeWithKey} for the full syntax including named keys.
   *
   * @defaultValue `"user"`
   */
  auth?: AuthModeWithKey | AuthModeWithKey[]

  /**
   * @deprecated Use {@link VerifyAuthOptions.auth} instead. Kept for backward
   * compatibility; will be removed in a future major release. When both are
   * provided, `auth` wins.
   */
  allow?: AuthModeWithKey | AuthModeWithKey[]

  /** Optional environment overrides (passed through to {@link resolveEnv}). */
  env?: Partial<SupabaseEnv>
}

/**
 * Explains an `Authorization` header that was present but yielded no token.
 *
 * {@link extractCredentials} only reads `Authorization: Bearer <token>`, so a
 * wrong scheme, wrong casing, or a bare token silently produces no credential
 * at all. That reads as "you sent nothing", which is the single most confusing
 * way for auth to fail — name it explicitly instead.
 *
 * @returns A hint sentence, or `null` when the header was genuinely absent or
 *   did carry a token.
 *
 * @internal
 */
function explainUnusableAuthorizationHeader(raw: string): string | null {
  const [scheme = '', ...rest] = raw.split(' ')

  // Correct scheme, so the only way `extractCredentials` yielded nothing is an
  // empty token. (Header values are trimmed in transit, so a trailing-space-only
  // value arrives here as a bare "Bearer".)
  if (scheme === 'Bearer') {
    return 'The Authorization header used the `Bearer` scheme but carried an empty token.'
  }
  if (scheme.toLowerCase() === 'bearer') {
    return (
      `The Authorization header used the scheme "${scheme}" — it must be exactly \`Bearer\`, ` +
      'capitalised, followed by a single space and the JWT.'
    )
  }
  if (rest.length > 0) {
    return `The Authorization header used the "${scheme}" scheme, not \`Bearer\`, so no token was read.`
  }
  return (
    'The Authorization header carried a bare value with no scheme. It must be ' +
    '`Authorization: Bearer <jwt>`.'
  )
}

/**
 * Extracts credentials from a request and verifies them in a single step.
 *
 * This is a convenience function that combines {@link extractCredentials} and
 * {@link verifyCredentials}. Use it when you want the full auth flow without
 * needing to inspect the raw credentials.
 *
 * @param request - The incoming HTTP request.
 * @param options - Auth modes to accept and optional environment overrides.
 *
 * @returns A result tuple: `{ data, error }`.
 *   - On success: `{ data: AuthResult, error: null }`
 *   - On failure: `{ data: null, error: AuthError }`
 *
 * @example User auth
 * ```ts
 * import { verifyAuth } from '@supabase/server/core'
 *
 * const { data: auth, error } = await verifyAuth(request, {
 *   auth: 'user',
 * })
 *
 * if (error) {
 *   return Response.json({ message: error.message }, { status: error.status })
 * }
 *
 * console.log(auth.userClaims!.id) // "d0f1a2b3-..."
 * ```
 *
 * @category Primitives
 */
export async function verifyAuth(
  request: Request,
  options: VerifyAuthOptions,
): Promise<
  { data: AuthResult; error: null } | { data: null; error: AuthError }
> {
  const credentials = extractCredentials(request)
  const result = await verifyCredentials(credentials, options)
  if (result.error === null || credentials.token) return result

  // Only reachable with the raw request in hand, so `verifyCredentials` can't
  // report it — layer it on here.
  const rawAuthorization = request.headers.get('authorization')
  if (!rawAuthorization) return result

  const hint = explainUnusableAuthorizationHeader(rawAuthorization)
  if (!hint) return result

  return {
    data: null,
    error: withExtraDiagnostics(result.error, {
      hint,
      details: {
        received: {
          ...(result.error.details?.received as Record<string, unknown>),
          authorization: 'non-bearer-scheme',
        },
      },
    }),
  }
}
