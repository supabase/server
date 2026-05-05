/**
 * Thrown when a required environment variable is missing or malformed.
 *
 * Always has `status: 500` — environment errors are server-side configuration issues.
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
   * @see {@link EnvGenericError}, {@link MissingSupabaseURLError},
   *   {@link MissingPublishableKeyError}, {@link MissingDefaultPublishableKeyError},
   *   {@link MissingSecretKeyError}, {@link MissingDefaultSecretKeyError}
   */
  readonly code: string

  constructor(message: string, code = EnvGenericError) {
    super(message)
    this.name = 'EnvError'
    this.code = code
  }
}

/** Generic environment error code. */
export const EnvGenericError = 'ENV_ERROR'

/** `SUPABASE_URL` is not set. */
export const MissingSupabaseURLError = 'MISSING_SUPABASE_URL'

/** Named publishable key not found in `SUPABASE_PUBLISHABLE_KEYS`. */
export const MissingPublishableKeyError = 'MISSING_PUBLISHABLE_KEY'

/** No default publishable key found. */
export const MissingDefaultPublishableKeyError =
  'MISSING_DEFAULT_PUBLISHABLE_KEY'

/** Named secret key not found in `SUPABASE_SECRET_KEYS`. */
export const MissingSecretKeyError = 'MISSING_SECRET_KEY'

/** No default secret key found. */
export const MissingDefaultSecretKeyError = 'MISSING_DEFAULT_SECRET_KEY'

const EnvErrorMap = {
  [MissingSupabaseURLError]: (): EnvError =>
    new EnvError(
      'SUPABASE_URL is required but not set',
      MissingSupabaseURLError,
    ),
  [MissingSecretKeyError]: (name: string): EnvError =>
    new EnvError(
      `No "${name}" secret key found. Include a "${name}" entry in SUPABASE_SECRET_KEYS.`,
      MissingSecretKeyError,
    ),
  [MissingDefaultSecretKeyError]: (): EnvError =>
    new EnvError(
      'No default secret key found. Set SUPABASE_SECRET_KEY or include a "default" entry in SUPABASE_SECRET_KEYS.',
      MissingDefaultSecretKeyError,
    ),

  [MissingPublishableKeyError]: (name: string): EnvError =>
    new EnvError(
      `No "${name}" publishable key found. Include a "${name}" entry in SUPABASE_PUBLISHABLE_KEYS.`,
      MissingPublishableKeyError,
    ),
  [MissingDefaultPublishableKeyError]: (): EnvError =>
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
 * const { data: ctx, error } = await createSupabaseContext(request, { auth: 'user' })
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
   * @see {@link AuthGenericError}, {@link InvalidCredentialsError},
   *   {@link CreateSupabaseClientError}
   */
  readonly code: string

  constructor(message: string, code = AuthGenericError, status = 401) {
    super(message)
    this.name = 'AuthError'
    this.code = code
    this.status = status
  }
}

/** Generic authentication error code. */
export const AuthGenericError = 'AUTH_ERROR'

/** No credential matched any allowed auth mode. */
export const InvalidCredentialsError = 'INVALID_CREDENTIALS'

/** Failed to create a Supabase client after auth succeeded. */
export const CreateSupabaseClientError = 'CREATE_SUPABASE_CLIENT_ERROR'

const AuthErrorMap = {
  [InvalidCredentialsError]: (): AuthError =>
    new AuthError('Invalid credentials', InvalidCredentialsError, 401),
  [CreateSupabaseClientError]: (): AuthError =>
    new AuthError(
      'Failed to create Supabase client',
      CreateSupabaseClientError,
      500,
    ),
}

/**
 * Factory map for all error types. Keyed by error code constant, each entry
 * returns a pre-configured {@link EnvError} or {@link AuthError}.
 *
 * @example
 * ```ts
 * throw Errors[MissingSupabaseURLError]()
 * throw Errors[MissingPublishableKeyError]('mobile')
 * ```
 */
export const Errors = {
  ...EnvErrorMap,
  ...AuthErrorMap,
}
