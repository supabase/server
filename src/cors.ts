import type { CorsConfig } from './types.js'

export function buildCorsHeaders(
  config?: boolean | CorsConfig,
): Record<string, string> {
  if (config === false) return {}

  const opts: CorsConfig = typeof config === 'object' ? config : {}

  const origins = opts.origins ?? '*'
  const origin = Array.isArray(origins) ? origins.join(', ') : origins

  const headers: Record<string, string> = {
    'Access-Control-Allow-Origin': origin,
    'Access-Control-Allow-Methods':
      opts.methods?.join(', ') ?? 'GET, POST, PUT, PATCH, DELETE, OPTIONS',
    'Access-Control-Allow-Headers':
      opts.headers?.join(', ') ??
      'Authorization, apikey, Content-Type, x-client-info',
  }

  if (opts.maxAge != null) {
    headers['Access-Control-Max-Age'] = String(opts.maxAge)
  }

  if (opts.credentials) {
    headers['Access-Control-Allow-Credentials'] = 'true'
  }

  return headers
}

export function addCorsHeaders(
  response: Response,
  config?: boolean | CorsConfig,
): Response {
  if (config === false) return response

  const corsHeaders = buildCorsHeaders(config)
  const newResponse = new Response(response.body, response)
  for (const [key, value] of Object.entries(corsHeaders)) {
    newResponse.headers.set(key, value)
  }
  return newResponse
}
