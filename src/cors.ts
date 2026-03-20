import { corsHeaders as defaultCorsHeaders } from '@supabase/supabase-js/cors'

type CorsConfig = boolean | Record<string, string>

export function buildCorsHeaders(config?: CorsConfig): Record<string, string> {
  if (config === false) return {}
  if (typeof config === 'object') return config
  return defaultCorsHeaders
}

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
