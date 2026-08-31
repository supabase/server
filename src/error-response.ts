import {
  ErrorCodeHeader,
  type ErrorPayload,
  type MinimalErrorPayload,
  type SupabaseServerError,
} from './errors.js'
import type { ErrorResponseConfig } from './types.js'

/**
 * Renders a {@link SupabaseServerError} as the JSON error response every layer
 * of the library returns.
 *
 * One place so `withSupabase` and the middleware that answer directly
 * (`withClaims`, `withRequiredClaims`, `withPostgresClient`) stay consistent:
 * same body, same `x-supabase-server-error` header, same status.
 *
 * @param error - The error to render.
 * @param options - Extra headers (CORS, typically) and body verbosity.
 *
 * @internal
 */
export function errorResponse(
  error: SupabaseServerError,
  options?: {
    /** Merged in ahead of the code header — CORS headers, typically. */
    headers?: Record<string, string>
    /** Body verbosity. @see {@link ErrorResponseConfig} */
    errors?: ErrorResponseConfig
  },
): Response {
  return Response.json(buildErrorBody(error, options?.errors), {
    status: error.status,
    headers: { ...options?.headers, [ErrorCodeHeader]: error.code },
  })
}

/**
 * Builds the response body, honouring {@link ErrorResponseConfig}.
 *
 * `detailed: false` reduces the body to `code` and `message` — everything
 * aimed at whoever is building against the endpoint (`hint`, `docs`,
 * `details`) comes off the wire. Provenance survives regardless: `message`
 * keeps its `[@supabase/server]` prefix, and the code is still sent as the
 * `x-supabase-server-error` header.
 *
 * The error object itself is untouched, so callers reading it directly still
 * get everything.
 *
 * @internal
 */
export function buildErrorBody(
  error: SupabaseServerError,
  errors?: ErrorResponseConfig,
): ErrorPayload | MinimalErrorPayload {
  const payload = error.toJSON()
  if (errors?.detailed !== false) return payload

  const { code, message } = payload
  return { code, message }
}
