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
 * | `"publishable"` | Publishable key | Client-facing, key-validated endpoints |
 * | `"secret"` | Secret key | Server-to-server, internal calls |
 * | `"none"` | None | Open endpoints |
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
  Errors,
  InvalidCredentialsError,
  MissingDefaultPublishableKeyError,
  MissingDefaultSecretKeyError,
  MissingPublishableKeyError,
  MissingSecretKeyError,
  MissingSupabaseURLError,
} from './errors.js'
