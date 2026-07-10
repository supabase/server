import { corsHeaders as defaultCorsHeaders } from '@supabase/supabase-js/cors'

/**
 * CORS configuration for {@link withSupabase}.
 *
 * - `'default'` — uses `@supabase/supabase-js` default CORS headers.
 * - `'none'` — disables CORS handling entirely.
 * - `{ headers }` — custom CORS headers to use.
 *
 * The boolean (`true`/`false`) and bare `Record<string, string>` forms are
 * deprecated but still accepted for backward compatibility.
 *
 * @internal
 */
type CorsConfig =
  | 'default'
  | 'none'
  | { headers: Record<string, string> }
  /** @deprecated Use `'default'` | `'none'` | `{ headers }` instead. */
  | boolean
  /** @deprecated Use `{ headers }` instead. */
  | Record<string, string>

/**
 * Whether the given CORS configuration disables CORS handling.
 *
 * @param config - The CORS configuration.
 * @returns `true` for `'none'` or the deprecated `false`, otherwise `false`.
 *
 * @internal
 */
export function isCorsDisabled(config?: CorsConfig): boolean {
  return config === false || config === 'none'
}

/**
 * Builds the CORS headers object based on the given configuration.
 *
 * @param config - The CORS configuration.
 * @returns A headers record to include in the response. Empty object if CORS is disabled.
 *
 * @internal
 */
export function buildCorsHeaders(config?: CorsConfig): Record<string, string> {
  if (isCorsDisabled(config)) return {}
  if (typeof config === 'object') {
    // New `{ headers }` shape vs the deprecated bare `Record<string, string>`.
    if ('headers' in config && typeof config.headers === 'object') {
      return config.headers
    }
    return config as Record<string, string>
  }
  return defaultCorsHeaders
}

/**
 * Returns a new `Response` with CORS headers appended.
 *
 * Creates a clone of the original response and sets each CORS header on it.
 * If CORS is disabled (`'none'` or the deprecated `false`), returns the original response unchanged.
 *
 * @param response - The original response to augment.
 * @param config - The CORS configuration.
 * @returns A new `Response` with CORS headers set, or the original response if CORS is disabled.
 *
 * @internal
 */
export function addCorsHeaders(
  response: Response,
  config?: CorsConfig,
): Response {
  if (isCorsDisabled(config)) return response

  const corsHeaders = buildCorsHeaders(config)
  const newResponse = new Response(response.body, response)
  for (const [key, value] of Object.entries(corsHeaders)) {
    newResponse.headers.set(key, value)
  }
  return newResponse
}
