import {
  Errors,
  MissingCredentialsError,
  UnusableCredentialError,
  type AuthError,
} from '../errors.js'
import type { AuthModeWithKey, AuthResult, SupabaseEnv } from '../types.js'
import { extractCredentials } from './extract-credentials.js'
import { diagnoseAuthorizationHeader } from './utils/authorization-header.js'
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

  // Only reachable with the raw request in hand: `verifyCredentials` sees a
  // null token and cannot tell "no header" from "header we couldn't read".
  const diagnosis = diagnoseAuthorizationHeader(
    request.headers.get('authorization'),
  )
  if (diagnosis.kind !== 'unreadable') return result

  // Restricted to MISSING_CREDENTIALS: any other code (a bad apikey, a
  // misconfiguration) describes the failure better than the Authorization
  // header being malformed.
  if (result.error.code !== MissingCredentialsError) return result

  return {
    data: null,
    error: Errors[UnusableCredentialError]({
      authModes: result.error.details?.acceptedAuthModes as
        | readonly string[]
        | undefined,
      received: {
        ...(result.error.details?.received as object),
        authorization: 'non-bearer-scheme',
      } as never,
      reason: diagnosis.reason,
      hint: diagnosis.hint,
    }),
  }
}
