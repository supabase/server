import { Errors, InvalidCredentialsError } from '../errors.js'
import type { AuthError } from '../errors.js'
import type { UserAuthResult, VerifyUserAuthOptions } from '../types.js'
import { verifyAuth } from './verify-auth.js'

const DEFAULT_AUDIENCE = 'authenticated'

function includesExpected(
  actual: string | string[] | undefined,
  expected: string | string[],
): boolean {
  if (!actual) return false
  const actualValues = Array.isArray(actual) ? actual : [actual]
  const expectedValues = Array.isArray(expected) ? expected : [expected]
  return expectedValues.some((value) => actualValues.includes(value))
}

/**
 * Verifies a Supabase user JWT and optionally checks its user ID.
 *
 * This is a narrower user-token API on top of {@link verifyAuth}. It requires
 * `auth: "user"`, defaults JWT audience validation to `"authenticated"`, and
 * returns non-null user claims on success.
 *
 * @param request - The incoming HTTP request.
 * @param options - Optional environment overrides, expected user ID, and audience.
 *
 * @returns A result tuple: `{ data, error }`.
 *   - On success: `{ data: UserAuthResult, error: null }`
 *   - On failure: `{ data: null, error: AuthError }`
 *
 * @example
 * ```ts
 * import { verifyUserAuth } from '@supabase/server/core'
 *
 * const { data: auth, error } = await verifyUserAuth(request, {
 *   userId: 'd0f1a2b3-...',
 * })
 *
 * if (error) {
 *   return Response.json({ message: error.message }, { status: error.status })
 * }
 *
 * console.log(auth.userClaims.id)
 * ```
 */
export async function verifyUserAuth(
  request: Request,
  options: VerifyUserAuthOptions = {},
): Promise<
  { data: UserAuthResult; error: null } | { data: null; error: AuthError }
> {
  const { data: auth, error } = await verifyAuth(request, {
    auth: 'user',
    env: options.env,
  })
  if (error) return { data: null, error }

  if (!auth.token || !auth.userClaims || !auth.jwtClaims) {
    return { data: null, error: Errors[InvalidCredentialsError]() }
  }

  const audience = options.audience ?? DEFAULT_AUDIENCE
  if (!includesExpected(auth.jwtClaims.aud, audience)) {
    return { data: null, error: Errors[InvalidCredentialsError]() }
  }

  if (options.userId && !includesExpected(auth.userClaims.id, options.userId)) {
    return { data: null, error: Errors[InvalidCredentialsError]() }
  }

  return {
    data: {
      token: auth.token,
      userClaims: auth.userClaims,
      jwtClaims: auth.jwtClaims,
    },
    error: null,
  }
}
