import {
  getAuthUrl,
  getResourceMetadataUrl,
  getResourceUrl,
  percentEncodeQuotes,
} from './url.js'
import type {
  ResourceMetadataOptions,
  UnauthorizedResponseOptions,
} from './types.js'

/**
 * `401` response with a `WWW-Authenticate: Bearer resource_metadata="..."` header (RFC 9728).
 * The metadata URL defaults to the Edge Functions derivation and throws off
 * platform; pass `resourceMetadataUrl` to override for custom setups.
 *
 * @category Middleware
 */
export function unauthorizedResponse(
  req: Request,
  options?: UnauthorizedResponseOptions,
): Response {
  const metadataUrl = percentEncodeQuotes(
    options?.resourceMetadataUrl ?? getResourceMetadataUrl(req),
  )
  return new Response(JSON.stringify({ error: 'Unauthorized' }), {
    status: 401,
    headers: {
      'Content-Type': 'application/json',
      'WWW-Authenticate': `Bearer resource_metadata="${metadataUrl}"`,
    },
  })
}

/**
 * RFC 9728 OAuth Protected Resource Metadata response.
 * Advertises the authorization server, resource URI, and bearer methods supported.
 * URLs default to the Edge Functions derivation and throw off platform; pass
 * `resource` / `authorizationServers` to override.
 *
 * @category Middleware
 */
export function resourceMetadataResponse(
  req: Request,
  options?: ResourceMetadataOptions,
): Response {
  const resource = options?.resource ?? getResourceUrl(req)
  const authorizationServers = options?.authorizationServers ?? [
    getAuthUrl(req),
  ]

  return new Response(
    JSON.stringify({
      resource,
      authorization_servers: authorizationServers,
      bearer_methods_supported: ['header'],
    }),
    {
      status: 200,
      headers: {
        'Content-Type': 'application/json',
        // Public discovery document — browser clients read it cross-origin.
        'Access-Control-Allow-Origin': '*',
      },
    },
  )
}
