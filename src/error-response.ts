import { ErrorCodeHeader, type SupabaseServerError } from './errors.js'

/**
 * Renders a {@link SupabaseServerError} as the JSON error response every layer
 * of the library returns.
 *
 * One place so `withSupabase` and the middleware that answer directly
 * (`withClaims`, `withRequiredClaims`, `withPostgresClient`) stay consistent:
 * same body, same `x-supabase-server-error` header, same status.
 *
 * @param error - The error to render.
 * @param options - Extra headers, merged in ahead of the code header.
 *
 * @internal
 */
export function errorResponse(
  error: SupabaseServerError,
  options?: {
    /** Merged in ahead of the code header — CORS headers, typically. */
    headers?: Record<string, string>
  },
): Response {
  return Response.json(error.toJSON(), {
    status: error.status,
    headers: { ...options?.headers, [ErrorCodeHeader]: error.code },
  })
}
