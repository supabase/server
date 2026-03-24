import { corsHeaders as defaultCorsHeaders } from '@supabase/supabase-js/cors'

/**
 * CORS configuration for {@link withSupabase}.
 *
 * - `true` — uses `@supabase/supabase-js` default CORS headers.
 * - `false` — disables CORS handling entirely.
 * - `Record<string, string>` — custom CORS headers to use.
 *
 * @internal
 */
type CorsConfig = boolean | Record<string, string>

/**
 * Builds the CORS headers object based on the given configuration.
 *
 * @param config - The CORS configuration.
 * @returns A headers record to include in the response. Empty object if CORS is disabled.
 *
 * @internal
 */
export function buildCorsHeaders(config?: CorsConfig): Record<string, string> {
  if (config === false) return {}
  if (typeof config === 'object') return config
  return defaultCorsHeaders
}

/**
 * Returns a new `Response` with CORS headers appended.
 *
 * Creates a clone of the original response and sets each CORS header on it.
 * If CORS is disabled (`config === false`), returns the original response unchanged.
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
  if (config === false) return response

  const corsHeaders = buildCorsHeaders(config)
  const newResponse = new Response(response.body, response)
  for (const [key, value] of Object.entries(corsHeaders)) {
    newResponse.headers.set(key, value)
  }
  return newResponse
}
