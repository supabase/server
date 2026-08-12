import { resourceMetadataResponse } from './responses.js'
import { getResourceMetadataUrl, inferFunctionName } from './url.js'

/**
 * Wraps a request handler with OAuth 2.1 Protected Resource behavior (RFC 9728)
 * for Supabase Edge Functions.
 *
 * - Serves OAuth Protected Resource Metadata at `GET /{fn}/oauth-protected-resource`
 * - Enriches any `401` from the inner handler with `WWW-Authenticate: Bearer resource_metadata="..."`
 * - Returns `404` for any other path (Edge Functions are single-endpoint - the inner handler owns `/{fn}` only)
 *
 * @category Middleware
 *
 * @example
 * ```ts
 * import { withOAuthProtectedResource, withSupabase } from '@supabase/server'
 *
 * Deno.serve(
 *   withOAuthProtectedResource(
 *     withSupabase({ auth: 'user' }, async (_req, { supabase }) => {
 *       const { data, error } = await supabase.from('items').select('*')
 *       if (error) throw error
 *       return Response.json(data)
 *     }),
 *   ),
 * )
 * ```
 */
export function withOAuthProtectedResource(
  handler: (req: Request) => Promise<Response>,
): (req: Request) => Promise<Response> {
  return async (req: Request): Promise<Response> => {
    const url = new URL(req.url)
    const fn = inferFunctionName(req)
    if (!fn) return new Response('Not Found', { status: 404 })
    const basePath = `/${fn}`

    // RFC 9728 — OAuth Protected Resource Metadata
    if (
      req.method === 'GET' &&
      url.pathname === `${basePath}/oauth-protected-resource`
    ) {
      return resourceMetadataResponse(req)
    }

    if (url.pathname !== basePath) {
      return new Response('Not Found', { status: 404 })
    }

    const response = await handler(req)

    // Enrich any 401 with WWW-Authenticate so clients can discover the auth server
    if (response.status === 401) {
      const headers = new Headers(response.headers)
      headers.set(
        'WWW-Authenticate',
        `Bearer resource_metadata="${getResourceMetadataUrl(req)}"`,
      )
      return new Response(response.body, {
        status: 401,
        statusText: response.statusText,
        headers,
      })
    }

    return response
  }
}
