/**
 * Supabase platform URL path prefixes used when reconstructing a resource's
 * external URLs. Kept in one place so the magic strings have a single source of
 * truth across the URL derivation and the middleware.
 *
 * @module
 */

/**
 * Path prefix the Supabase Edge Functions platform proxy strips from the request
 * before invoking the function, and which the Edge Functions default restores
 * when reconstructing the resource's external path.
 *
 * @internal
 */
export const EDGE_FUNCTIONS_PATH_PREFIX = '/functions/v1'

/**
 * Path prefix of the Supabase Auth API, appended to the project's base URL to
 * form the OAuth authorization server URL advertised in the resource metadata.
 *
 * @internal
 */
export const AUTH_PATH_PREFIX = '/auth/v1'
