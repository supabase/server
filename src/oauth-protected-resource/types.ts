/**
 * **Alpha.** Options for {@link unauthorizedResponse}.
 *
 * The OAuth Protected Resource surface is alpha — the config shape, the
 * contributed context key, and the metadata route may change in a minor
 * release.
 *
 * @alpha
 * @category Types
 */
export interface UnauthorizedResponseOptions {
  /** Absolute URL override for the resource metadata endpoint. */
  resourceMetadataUrl?: string
}

/**
 * **Alpha.** Options for {@link resourceMetadataResponse}.
 *
 * The OAuth Protected Resource surface is alpha — the config shape, the
 * contributed context key, and the metadata route may change in a minor
 * release.
 *
 * @alpha
 * @category Types
 */
export interface ResourceMetadataOptions {
  /** Override the resource URI. */
  resource?: string
  /** Override the authorization servers list. */
  authorizationServers?: string[]
}
