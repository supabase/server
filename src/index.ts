/**
 * Server-side Supabase utilities for modern runtimes.
 *
 * `@supabase/server` gives you batteries-included auth and client creation for
 * Edge Functions, Workers, and any server runtime that speaks standard `fetch`.
 * One import, one line of config — auth is verified, Supabase clients are ready,
 * CORS is handled. Your handler only runs on successful auth.
 *
 * ```ts
 * import { withSupabase } from '@supabase/server'
 *
 * export default {
 *   fetch: withSupabase({ auth: 'user' }, async (_req, ctx) => {
 *     const { data: myGames } = await ctx.supabase.from('favorite_games').select()
 *     return Response.json(myGames)
 *   }),
 * }
 * ```
 *
 * ## Auth modes
 *
 * | Mode | Credential | Use case |
 * |------|-----------|----------|
 * | `"user"` | Valid JWT | Authenticated user endpoints |
 * | `"publishable"` | `default` publishable key | Client-facing, key-validated endpoints |
 * | `"secret"` | `default` secret key | Server-to-server, internal calls |
 * | `"none"` | None | Open endpoints |
 *
 * Bare `"publishable"` / `"secret"` match only the `default` key; use
 * `"secret:<name>"` for a specific key or `"secret:*"` to accept any key.
 *
 * Array syntax tries modes in order — first match wins:
 * ```ts
 * withSupabase({ auth: ['user', 'secret'] }, handler)
 * ```
 *
 * ## Framework adapters
 *
 * Adapters for Hono, H3 / Nuxt, Elysia, and NestJS ship inside this package:
 *
 * ```ts
 * import { withSupabase } from '@supabase/server/adapters/hono'
 * import { withSupabase } from '@supabase/server/adapters/h3'
 * import { withSupabase } from '@supabase/server/adapters/elysia'
 * import { withSupabase, SupabaseCtx } from '@supabase/server/adapters/nestjs'
 * ```
 *
 * ## Composable primitives
 *
 * For custom flows, all lower-level functions are available from `@supabase/server/core`:
 *
 * ```ts
 * import { verifyAuth, createContextClient, createAdminClient } from '@supabase/server/core'
 * ```
 *
 * ## OAuth 2.1 Protected Resource
 *
 * `withOAuthProtectedResource` adds RFC 9728 OAuth Protected Resource Metadata
 * and `WWW-Authenticate` discovery around any handler — useful for building
 * OAuth-protected APIs (e.g. an MCP server) on Supabase Edge Functions:
 *
 * ```ts
 * import { withOAuthProtectedResource, withSupabase } from '@supabase/server'
 *
 * Deno.serve(
 *   withOAuthProtectedResource(
 *     withSupabase({ auth: 'user' }, async (_req, { supabase }) => {
 *       const { data } = await supabase.from('items').select('*')
 *       return Response.json(data)
 *     }),
 *   ),
 * )
 * ```
 *
 * ## Installation
 *
 * ```sh
 * npm install @supabase/server
 * # or
 * deno add jsr:@supabase/server
 * ```
 *
 * @module
 * @packageDocumentation
 */

export { withSupabase } from './with-supabase.js'
export { createSupabaseContext } from './create-supabase-context.js'

export { withOAuthProtectedResource } from './oauth-protected-resource/with-oauth-protected-resource.js'
export type {
  OAuthProtectedResourceConfig,
  OAuthProtectedResourceContribution,
} from './oauth-protected-resource/with-oauth-protected-resource.js'
export { fromSupabaseUrl } from './oauth-protected-resource/url.js'
export type { UrlOption } from './oauth-protected-resource/url.js'
export {
  resourceMetadataResponse,
  unauthorizedResponse,
} from './oauth-protected-resource/responses.js'
export type {
  ResourceMetadataOptions,
  UnauthorizedResponseOptions,
} from './oauth-protected-resource/types.js'

export type {
  Allow,
  AllowWithKey,
  AuthMode,
  AuthModeWithKey,
  AuthResult,
  ClientAuth,
  CreateAdminClientOptions,
  CreateContextClientOptions,
  Credentials,
  JWTClaims,
  SupabaseContext,
  SupabaseEnv,
  UserClaims,
  WithSupabaseConfig,
} from './types.js'

export {
  AuthError,
  AuthGenericError,
  CreateSupabaseClientError,
  EnvError,
  EnvGenericError,
  ErrorCodeHeader,
  Errors,
  ErrorSource,
  InvalidApiKeyError,
  InvalidCredentialsError,
  InvalidJwtError,
  JwksFetchFailedError,
  JwksNotConfiguredError,
  MissingAuthorizationServerError,
  MissingConnectionStringError,
  MissingCredentialsError,
  MissingDefaultPublishableKeyError,
  MissingDefaultSecretKeyError,
  MissingPublishableKeyError,
  MissingResourceServerError,
  MissingSecretKeyError,
  MissingSupabaseURLError,
  NoKeysConfiguredError,
  SupabaseServerError,
  UnsupportedRoleError,
} from './errors.js'

export type {
  ApiKeyFormat,
  AuthFailureContext,
  ErrorPayload,
  ReceivedCredentials,
  SupabaseServerErrorOptions,
} from './errors.js'
