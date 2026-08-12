import { getAuthUrl, getResourceMetadataUrl, getResourceUrl } from './url.js'
import type {
  ResourceMetadataOptions,
  UnauthorizedResponseOptions,
} from './types.js'

/**
 * `401` response with a `WWW-Authenticate: Bearer resource_metadata="..."` header (RFC 9728).
 * Auto-constructs the metadata URL from `X-Forwarded-*` headers.
 * Pass `resourceMetadataUrl` to override for custom setups.
 *
 * @category Middleware
 */
export function unauthorizedResponse(
  req: Request,
  options?: UnauthorizedResponseOptions,
): Response {
  const metadataUrl =
    options?.resourceMetadataUrl ?? getResourceMetadataUrl(req)
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
 * Auto-constructs URLs from `X-Forwarded-*` headers.
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
      headers: { 'Content-Type': 'application/json' },
    },
  )
}
