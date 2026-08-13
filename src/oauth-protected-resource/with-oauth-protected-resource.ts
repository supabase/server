import { resourceMetadataResponse } from './responses.js'
import { getResourceMetadataUrl, inferFunctionName } from './url.js'

/**
 * Wraps a request handler with OAuth 2.1 Protected Resource behavior (RFC 9728)
 * for Supabase Edge Functions.
 *
 * - Serves OAuth Protected Resource Metadata at `GET /{fn}/oauth-protected-resource`
 *   (with permissive CORS, including the `OPTIONS` preflight, so browser-based clients can read it)
 * - Enriches a `401` from the inner handler with `WWW-Authenticate: Bearer resource_metadata="..."`,
 *   unless the handler already set a `WWW-Authenticate` header (its value wins)
 * - Returns `404` for any other path (Edge Functions are single-endpoint - the inner handler owns `/{fn}` only)
 *
 * The returned handler's optional second parameter is the host's platform
 * argument (a Workers `env`, a Deno `ServeHandlerInfo`) and is forwarded to
 * the inner handler unchanged — required for `withSupabase` to capture it.
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
  handler: (req: Request, platformArg?: unknown) => Promise<Response>,
): (req: Request, platformArg?: unknown) => Promise<Response> {
  return async (req: Request, platformArg?: unknown): Promise<Response> => {
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

    // CORS preflight for the metadata route — browser-based clients (e.g.
    // MCP Inspector) fetch the discovery document cross-origin.
    if (
      req.method === 'OPTIONS' &&
      url.pathname === `${basePath}/oauth-protected-resource`
    ) {
      return new Response(null, {
        status: 204,
        headers: {
          'Access-Control-Allow-Origin': '*',
          'Access-Control-Allow-Methods': 'GET, OPTIONS',
          'Access-Control-Allow-Headers': 'content-type, mcp-protocol-version',
        },
      })
    }

    if (url.pathname !== basePath) {
      return new Response('Not Found', { status: 404 })
    }

    const response = await handler(req, platformArg)

    // Enrich a 401 with WWW-Authenticate so clients can discover the auth
    // server — unless the handler already set one (its value wins, e.g. an
    // RFC 6750 error or a custom resource_metadata override).
    if (response.status === 401 && !response.headers.has('WWW-Authenticate')) {
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
