/**
 * Options for {@link unauthorizedResponse}.
 *
 * @category Types
 */
export interface UnauthorizedResponseOptions {
  /** Absolute URL override for the resource metadata endpoint. */
  resourceMetadataUrl?: string
}

/**
 * Options for {@link resourceMetadataResponse}.
 *
 * @category Types
 */
export interface ResourceMetadataOptions {
  /** Override the resource URI. */
  resource?: string
  /** Override the authorization servers list. */
  authorizationServers?: string[]
}
