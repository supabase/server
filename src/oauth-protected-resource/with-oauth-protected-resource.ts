import { defineMiddleware } from '@supabase/middleware'
import type { Middleware } from '@supabase/middleware'

import { resourceMetadataResponse } from './responses.js'
import { getResourceMetadataUrl, inferFunctionName } from './url.js'

/** Shape contributed at `ctx.oauthProtectedResource`. */
export interface OAuthProtectedResourceContribution {
  /** Absolute URL of this resource's OAuth Protected Resource Metadata document (RFC 9728). */
  resourceMetadataUrl: string
}

/**
 * Wraps a request handler with OAuth 2.1 Protected Resource behavior (RFC 9728)
 * for Supabase Edge Functions.
 *
 * - Serves OAuth Protected Resource Metadata at `GET /{fn}/oauth-protected-resource`
 *   (with permissive CORS, including the `OPTIONS` preflight, so browser-based clients can read it)
 * - Enriches a `401` from the inner handler with `WWW-Authenticate: Bearer resource_metadata="..."`,
 *   unless the handler already set a `WWW-Authenticate` header (its value wins)
 * - Passes any other path through to the inner handler unchanged (composition,
 *   not routing, decides what happens to it)
 *
 * Contributes `ctx.oauthProtectedResource` (the resolved metadata URL) to the
 * downstream context. Nested under `withSupabase`, the key is typed on the
 * handler's `ctx` when the outermost call is anchored with
 * `satisfies FetchHandler` — see `withSupabase`'s type note.
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
export const withOAuthProtectedResource: Middleware<
  'oauthProtectedResource',
  undefined,
  Record<never, never>,
  OAuthProtectedResourceContribution
> = defineMiddleware<
  'oauthProtectedResource',
  undefined,
  Record<never, never>,
  OAuthProtectedResourceContribution
>({
  key: 'oauthProtectedResource',
  run: () =>
    async function* (req) {
      const url = new URL(req.url)
      const fn = inferFunctionName(req)
      const metadataPath = fn ? `/${fn}/oauth-protected-resource` : undefined

      // RFC 9728 — OAuth Protected Resource Metadata
      if (
        metadataPath &&
        req.method === 'GET' &&
        url.pathname === metadataPath
      ) {
        return resourceMetadataResponse(req)
      }

      // CORS preflight for the metadata route — browser-based clients (e.g.
      // MCP Inspector) fetch the discovery document cross-origin.
      if (
        metadataPath &&
        req.method === 'OPTIONS' &&
        url.pathname === metadataPath
      ) {
        return new Response(null, {
          status: 204,
          headers: {
            'Access-Control-Allow-Origin': '*',
            'Access-Control-Allow-Methods': 'GET, OPTIONS',
            'Access-Control-Allow-Headers':
              'content-type, mcp-protocol-version',
          },
        })
      }

      const resourceMetadataUrl = getResourceMetadataUrl(req)
      const response = yield {
        oauthProtectedResource: { resourceMetadataUrl },
      }

      // Enrich a 401 with WWW-Authenticate so clients can discover the auth
      // server — unless the handler already set one (its value wins, e.g. an
      // RFC 6750 error or a custom resource_metadata override).
      if (
        response.status === 401 &&
        !response.headers.has('WWW-Authenticate')
      ) {
        const headers = new Headers(response.headers)
        headers.set(
          'WWW-Authenticate',
          `Bearer resource_metadata="${resourceMetadataUrl}"`,
        )
        return new Response(response.body, {
          status: 401,
          statusText: response.statusText,
          headers,
        })
      }

      return response
    },
})
