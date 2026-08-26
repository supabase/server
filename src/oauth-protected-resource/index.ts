/**
 * OAuth 2.1 Protected Resource middleware (RFC 9728) for Supabase Edge Functions.
 * @module
 * @packageDocumentation
 */

export { withOAuthProtectedResource } from './with-oauth-protected-resource.js'
export type {
  OAuthProtectedResourceConfig,
  OAuthProtectedResourceContribution,
} from './with-oauth-protected-resource.js'
export { fromSupabaseUrl } from './url.js'
export type { UrlOption } from './url.js'
export { resourceMetadataResponse, unauthorizedResponse } from './responses.js'
export type {
  ResourceMetadataOptions,
  UnauthorizedResponseOptions,
} from './types.js'
