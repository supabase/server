/**
 * Thrown when a required environment variable is missing or malformed.
 *
 * Has a fixed `status` of `500` since environment errors are server-side
 * configuration issues, not client errors.
 *
 * @example
 * ```ts
 * import { EnvError } from '@supabase/edge-functions'
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
   * - `"MISSING_PUBLISHABLE_KEY"` — No publishable key found
   * - `"MISSING_SECRET_KEY"` — No secret key found
   * - `"ENV_ERROR"` — Generic environment error
   */
  readonly code: string

  constructor(message: string, code = 'ENV_ERROR') {
    super(message)
    this.name = 'EnvError'
    this.code = code
  }
}

/**
 * Thrown when authentication or authorization fails.
 *
 * Carries an HTTP `status` code suitable for returning directly in a response
 * (typically `401` for invalid credentials, `500` for server-side auth failures).
 *
 * @example
 * ```ts
 * import { AuthError, createSupabaseContext } from '@supabase/edge-functions'
 *
 * const { data: ctx, error } = await createSupabaseContext(request, { allow: 'user' })
 * if (error) {
 *   // error is an AuthError
 *   return Response.json(
 *     { error: error.message, code: error.code },
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

  constructor(message: string, code = 'AUTH_ERROR', status = 401) {
    super(message)
    this.name = 'AuthError'
    this.code = code
    this.status = status
  }
}
