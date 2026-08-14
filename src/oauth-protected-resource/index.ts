/**
 * OAuth 2.1 Protected Resource middleware (RFC 9728) for Supabase Edge Functions.
 * @module
 * @packageDocumentation
 */

export { withOAuthProtectedResource } from './with-oauth-protected-resource.js'
export { resourceMetadataResponse, unauthorizedResponse } from './responses.js'
export type {
  ResourceMetadataOptions,
  UnauthorizedResponseOptions,
} from './types.js'
