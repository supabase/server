import type { AuthError } from '../errors.js'
import type { AllowWithKey, AuthResult, SupabaseEnv } from '../types.js'
import { extractCredentials } from './extract-credentials.js'
import { verifyCredentials } from './verify-credentials.js'

/**
 * Options for {@link verifyAuth}.
 */
interface VerifyAuthOptions {
  /**
   * Auth mode(s) to try. Modes are attempted in order — the first match wins.
   *
   * @see {@link AllowWithKey} for the full syntax including named keys.
   */
  allow: AllowWithKey | AllowWithKey[]

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
 * @example
 * ```ts
 * import { verifyAuth } from '@supabase/server/core'
 *
 * const { data: auth, error } = await verifyAuth(request, {
 *   allow: 'user',
 * })
 *
 * if (error) {
 *   return Response.json({ message: error.message }, { status: error.status })
 * }
 *
 * console.log(auth.userClaims!.id) // "d0f1a2b3-..."
 * ```
 */
export async function verifyAuth(
  request: Request,
  options: VerifyAuthOptions,
): Promise<
  { data: AuthResult; error: null } | { data: null; error: AuthError }
> {
  const credentials = extractCredentials(request)
  return verifyCredentials(credentials, options)
}
