import { defineMiddleware } from '@supabase/middleware'
import type { Middleware } from '@supabase/middleware'

import { resourceMetadataResponse } from './responses.js'
import { getAuthUrl, getResourceMetadataUrl, getResourceUrl } from './url.js'
import type { UrlOption } from './url.js'

/** Shape contributed at `ctx.oauthProtectedResource`. */
export interface OAuthProtectedResourceContribution {
  /** Absolute URL of this resource's OAuth Protected Resource Metadata document (RFC 9728). */
  resourceMetadataUrl: string
}

/**
 * Configuration for {@link withOAuthProtectedResource}.
 *
 * Both options accept a fixed string or a function of the request. Both default
 * to values derived from the request as it arrives through the Supabase Edge
 * Functions proxy, so no configuration is needed there.
 *
 * @category Types
 */
export interface OAuthProtectedResourceConfig {
  /**
   * The resource identifier to advertise — this endpoint's externally-visible
   * URL, which RFC 9728 §3.3 requires to equal the URL the client called.
   *
   * Defaults to the Edge Functions derivation. Required on any other backend,
   * usually from the request — `(req) => new URL(req.url).origin + '/api/mcp'`
   * — and throws `EnvError` (`MISSING_RESOURCE_SERVER`) if unset there.
   */
  resourceServer?: UrlOption
  /**
   * The OAuth 2.1 authorization server to advertise, as an issuer identifier.
   *
   * Defaults to the project's Supabase Auth on Edge Functions. Elsewhere it
   * falls back to `SUPABASE_PUBLIC_URL`, then `SUPABASE_URL`, each with
   * `/auth/v1` appended, and throws `EnvError` (`MISSING_AUTHORIZATION_SERVER`)
   * if neither is set. Pass {@link fromSupabaseUrl} for a specific project, or
   * any other issuer directly.
   */
  authorizationServer?: UrlOption
}

/**
 * Wraps a request handler with OAuth 2.1 Protected Resource behavior (RFC 9728).
 *
 * - Serves OAuth Protected Resource Metadata at `GET {resource}/oauth-protected-resource`
 *   (with permissive CORS, including the `OPTIONS` preflight, so browser-based clients can read it)
 * - Enriches a `401` from the inner handler with `WWW-Authenticate: Bearer resource_metadata="..."`,
 *   unless the handler already set a `WWW-Authenticate` header (its value wins)
 * - Passes any other path through to the inner handler unchanged (composition,
 *   not routing, decides what happens to it)
 *
 * The metadata route is matched on the path *suffix*, so **any** `GET` or
 * `OPTIONS` ending in `/oauth-protected-resource` is answered here and never
 * reaches the inner handler, at any depth. Other methods pass through.
 *
 * Zero-config on Supabase Edge Functions. Elsewhere
 * {@link OAuthProtectedResourceConfig.resourceServer} is required and
 * {@link OAuthProtectedResourceConfig.authorizationServer} falls back to
 * `SUPABASE_URL`; each throws an `EnvError` when it cannot be resolved.
 *
 * Contributes `ctx.oauthProtectedResource` (the resolved metadata URL) to the
 * downstream context. Nested under `withSupabase`, the key is typed on the
 * handler's `ctx` when the outermost call is anchored with
 * `satisfies FetchHandler` — see `withSupabase`'s type note.
 *
 * @category Middleware
 *
 * @example Supabase Edge Functions — zero config
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
 *
 * @example Any other backend
 * ```ts
 * import { withOAuthProtectedResource, fromSupabaseUrl } from '@supabase/server'
 *
 * export default {
 *   fetch: withOAuthProtectedResource(
 *     {
 *       resourceServer: (req) => new URL(req.url).origin + '/api/mcp',
 *       authorizationServer: fromSupabaseUrl('https://abc123.supabase.co'),
 *     },
 *     handler,
 *   ),
 * }
 * ```
 *
 * @example A non-Supabase authorization server
 * ```ts
 * withOAuthProtectedResource(
 *   {
 *     resourceServer: 'https://api.example.com/mcp',
 *     authorizationServer: 'https://example.clerk.accounts.dev',
 *   },
 *   handler,
 * )
 * ```
 */
export const withOAuthProtectedResource: Middleware<
  'oauthProtectedResource',
  OAuthProtectedResourceConfig | undefined,
  Record<never, never>,
  OAuthProtectedResourceContribution
> = defineMiddleware<
  'oauthProtectedResource',
  OAuthProtectedResourceConfig | undefined,
  Record<never, never>,
  OAuthProtectedResourceContribution
>({
  key: 'oauthProtectedResource',
  run: (config) =>
    async function* (req) {
      const url = new URL(req.url)
      // The metadata document lives at `{resource}/oauth-protected-resource`.
      // Matching on the suffix keeps this working wherever the endpoint is
      // mounted, without assuming the Edge Functions path convention.
      const isMetadataRoute = url.pathname.endsWith('/oauth-protected-resource')

      // RFC 9728 — OAuth Protected Resource Metadata
      if (isMetadataRoute && req.method === 'GET') {
        return resourceMetadataResponse(req, {
          resource: getResourceUrl(req, config?.resourceServer),
          authorizationServers: [getAuthUrl(req, config?.authorizationServer)],
        })
      }

      // CORS preflight for the metadata route — browser-based clients fetch the
      // discovery document cross-origin.
      if (isMetadataRoute && req.method === 'OPTIONS') {
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

      const resourceMetadataUrl = getResourceMetadataUrl(
        req,
        config?.resourceServer,
      )
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
        const challenge = `Bearer resource_metadata="${resourceMetadataUrl}"`
        try {
          response.headers.set('WWW-Authenticate', challenge)
          return response
        } catch {
          // Headers on a fetch()-proxied response carry the immutable guard,
          // so enrichment falls back to a copy. A copy cannot carry `.url` or
          // `.redirected` and cannot reuse a consumed body stream, which is
          // why in-place mutation is the primary path.
          const headers = new Headers(response.headers)
          headers.set('WWW-Authenticate', challenge)
          return new Response(response.bodyUsed ? null : response.body, {
            status: response.status,
            statusText: response.statusText,
            headers,
          })
        }
      }

      return response
    },
})
