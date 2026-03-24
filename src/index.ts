/**
 * `@supabase/edge-functions` — Server-side Supabase utilities for modern runtimes.
 *
 * This package provides authentication, client creation, and context injection for
 * any server-side environment that supports the standard `fetch` handler pattern —
 * Supabase Edge Functions, Cloudflare Workers, Bun, Deno, and others.
 *
 * ## Two-layer architecture
 *
 * **Layer 1 — Declarative wrappers** (this module):
 * - {@link withSupabase} — Wraps a handler with auth + CORS + context creation.
 * - {@link createSupabaseContext} — Creates a context directly (for frameworks / custom middleware).
 *
 * **Layer 2 — Composable primitives** (`@supabase/edge-functions/core`):
 * - {@link resolveEnv}, {@link extractCredentials}, {@link verifyCredentials},
 *   {@link verifyAuth}, {@link createContextClient}, {@link createAdminClient}
 *
 * Layer 1 is built on Layer 2. Both produce the same {@link SupabaseContext}.
 *
 * ## Quick start
 *
 * ```ts
 * import { withSupabase } from '@supabase/edge-functions'
 *
 * export default {
 *   fetch: withSupabase({ allow: 'user' }, async (req, ctx) => {
 *     const { data } = await ctx.supabase.rpc('get_my_profile')
 *     return Response.json(data)
 *   }),
 * }
 * ```
 *
 * @packageDocumentation
 */

export { withSupabase } from './with-supabase.js'
export { createSupabaseContext } from './create-supabase-context.js'
export { resolveEnv } from './core/resolve-env.js'
export { extractCredentials } from './core/extract-credentials.js'
export { verifyCredentials } from './core/verify-credentials.js'
export { verifyAuth } from './core/verify-auth.js'
export { createContextClient } from './core/create-context-client.js'
export { createAdminClient } from './core/create-admin-client.js'
export type {
  Allow,
  AllowWithKey,
  AuthResult,
  Credentials,
  JWTClaims,
  SupabaseContext,
  SupabaseEnv,
  UserClaims,
  WithSupabaseConfig,
} from './types.js'
export { AuthError, EnvError } from './errors.js'
