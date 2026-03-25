/**
 * Thrown when a required environment variable is missing or malformed.
 *
 * Has a fixed `status` of `500` since environment errors are server-side
 * configuration issues, not client errors.
 *
 * @example
 * ```ts
 * import { EnvError } from '@supabase/server'
 *
 * try {
 *   const client = createAdminClient()
 * } catch (e) {
 *   if (e instanceof EnvError) {
 *     console.error(`Config issue [${e.code}]: ${e.message}`)
 *     // → "Config issue [MISSING_SUPABASE_URL]: SUPABASE_URL is required but not set"
 *   }
 * }
 * ```
 */
export class EnvError extends Error {
  /** Always `500` — environment errors are server-side issues. */
  readonly status = 500

  /**
   * Machine-readable error code.
   *
   * Known codes:
   * - `"MISSING_SUPABASE_URL"` — `SUPABASE_URL` not set
   * - `"MISSING_PUBLISHABLE_KEY"` — No publishable key found for the given keyname
   * - `"MISSING_DEFATUL_PUBLISHABLE_KEY"` — No default publishable key found
   * - `"MISSING_SECRET_KEY"` — No secret key found for the given keyname
   * - `"MISSING_DEFAULT_SECRET_KEY"` — No defatult secret key found
   * - `"ENV_ERROR"` — Generic environment error
   */
  readonly code: string

  constructor(message: string, code = EnvGenericError) {
    super(message)
    this.name = 'EnvError'
    this.code = code
  }
}

export const EnvGenericError = 'ENV_ERROR'
export const MissingSupabaseURLError = 'MISSING_SUPABASE_URL'
export const MissingPublishableKeyError = 'MISSING_PUBLISHABLE_KEY'
export const MissingDefaultPublishableKeyError =
  'MISSING_DEFAULT_PUBLISHABLE_KEY'
export const MissingSecretKeyError = 'MISSING_SECRET_KEY'
export const MissingDefaultSecretKeyError = 'MISSING_DEFAULT_SECRET_KEY'

const EnvErrorMap = {
  [MissingSupabaseURLError]: () =>
    new EnvError(
      'SUPABASE_URL is required but not set',
      MissingSupabaseURLError,
    ),
  [MissingSecretKeyError]: (name: string) =>
    new EnvError(
      `No "${name}" secret key found. Include a "${name}" entry in SUPABASE_SECRET_KEYS.`,
      MissingSecretKeyError,
    ),
  [MissingDefaultSecretKeyError]: () =>
    new EnvError(
      'No default secret key found. Set SUPABASE_SECRET_KEY or include a "default" entry in SUPABASE_SECRET_KEYS.',
      MissingDefaultSecretKeyError,
    ),

  [MissingPublishableKeyError]: (name: string) =>
    new EnvError(
      `No "${name}" publishable key found. Include a "${name}" entry in SUPABASE_PUBLISHABLE_KEYS.`,
      MissingPublishableKeyError,
    ),
  [MissingDefaultPublishableKeyError]: () =>
    new EnvError(
      'No default publishable key found. Set SUPABASE_PUBLISHABLE_KEY or include a "default" entry in SUPABASE_PUBLISHABLE_KEYS.',
      MissingDefaultPublishableKeyError,
    ),
}

/**
 * Thrown when authentication or authorization fails.
 *
 * Carries an HTTP `status` code suitable for returning directly in a response
 * (typically `401` for invalid credentials, `500` for server-side auth failures).
 *
 * @example
 * ```ts
 * import { AuthError, createSupabaseContext } from '@supabase/server'
 *
 * const { data: ctx, error } = await createSupabaseContext(request, { allow: 'user' })
 * if (error) {
 *   // error is an AuthError
 *   return Response.json(
 *     { message: error.message, code: error.code },
 *     { status: error.status },
 *   )
 * }
 * ```
 */
export class AuthError extends Error {
  /**
   * HTTP status code.
   *
   * - `401` — Invalid or missing credentials
   * - `500` — Server-side auth failure (e.g., missing JWKS, env misconfiguration)
   */
  readonly status: number

  /**
   * Machine-readable error code.
   *
   * Known codes:
   * - `"INVALID_CREDENTIALS"` — No credential matched any allowed auth mode
   * - `"CLIENT_ERROR"` — Failed to create a Supabase client after auth succeeded
   * - `"AUTH_ERROR"` — Generic authentication error
   * - Any `EnvError` code (propagated when env resolution fails during auth)
   */
  readonly code: string

  constructor(message: string, code = AuthGenericError, status = 401) {
    super(message)
    this.name = 'AuthError'
    this.code = code
    this.status = status
  }
}

export const AuthGenericError = 'AUTH_ERROR'
export const InvalidCredentialsError = 'INVALID_CREDENTIALS'
export const CreateSupabaseClientError = 'CREATE_SUPABASE_CLIENT_ERROR'

const AuthErrorMap = {
  [InvalidCredentialsError]: () =>
    new AuthError('Invalid credentials', InvalidCredentialsError, 401),
  [CreateSupabaseClientError]: () =>
    new AuthError(
      'Failed to create Supabase client',
      CreateSupabaseClientError,
      500,
    ),
}

export const Errors = {
  ...EnvErrorMap,
  ...AuthErrorMap,
}
