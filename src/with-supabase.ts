import { defineComposite } from '@supabase/middleware'
import type { BaseContext, Entry } from '@supabase/middleware'

import { withConstructionBoundary } from './core/parts/boundary.js'
import { withSupabaseCors } from './core/parts/cors.js'
import { withAuthGate } from './core/parts/gate.js'
import {
  withAuthKeyName,
  withAuthMode,
  withJwtClaims,
  withUserClaims,
} from './core/parts/projections.js'
import { withSupabaseAdminClient } from './middleware/admin-client/index.js'
import { withSupabaseClient } from './middleware/client/index.js'
import type { SupabaseContext, WithSupabaseConfig } from './types.js'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyHandler = (req: Request, ctx: any) => Promise<Response>

/**
 * The parts `withSupabase` is made of, outermost first. Each contributes one
 * key; the composite derives its contributions from them and keeps
 * `supabaseCors`, `supabaseBoundary` and `supabaseAuth` internal, so the
 * handler sees exactly {@link SupabaseContext}.
 *
 * Order is load-bearing: the CORS part must see every response on the way
 * out, the boundary must sit above the client parts whose construction
 * errors it maps, the gate must run before the projections that read its
 * result, and the projections must run before the client parts, which read
 * the flat `authMode` / `authKeyName` keys to mirror the matched credential.
 */
const composite = defineComposite({
  build: (config: WithSupabaseConfig) =>
    [
      withSupabaseCors(config),
      withConstructionBoundary(config),
      withAuthGate(config),
      withUserClaims(),
      withJwtClaims(),
      withAuthMode(),
      withAuthKeyName(),
      withSupabaseClient({
        env: config.env,
        supabaseOptions: config.supabaseOptions,
      }),
      withSupabaseAdminClient({
        env: config.env,
        supabaseOptions: config.supabaseOptions,
      }),
    ] as const,
  internal: ['supabaseCors', 'supabaseBoundary', 'supabaseAuth'],
})

/**
 * The config-only overload declares `Entry<SupabaseContext<Database>>`; this
 * holds only while every public key the parts contribute is in
 * `SupabaseContext` and no public key is listed under `internal`.
 */
type EntryIsSound =
  ReturnType<typeof composite> extends Entry<SupabaseContext> ? true : false
const entryIsSound: EntryIsSound = true
void entryIsSound

/**
 * Wraps a request handler with Supabase auth, client creation, and CORS handling.
 *
 * Built for the Web API `Request`/`Response` standard that all modern runtimes
 * implement natively. Handles CORS preflight, credential verification,
 * context creation, and error responses. Your handler only runs on successful auth.
 *
 * @param config - Auth modes, CORS, and environment overrides. See {@link WithSupabaseConfig}.
 * @param handler - Receives the `Request` and a fully-initialized {@link SupabaseContext}.
 * @returns A fetch handler. The optional second parameter is the host's
 * platform argument (a Workers `env`, a Deno `ServeHandlerInfo`) — when the
 * runtime supplies one, it is captured as the platform env behind
 * `@supabase/middleware`'s `getEnv` for any composed middleware. Nested under
 * another middleware, it is that middleware's accumulated context instead,
 * which is reused rather than reseeded. At the entry point the request body
 * is buffered, so a nested middleware and the handler can both read it.
 *
 * **Type note.** `Base` carries an upstream middleware's contributions into the
 * handler's `ctx`: with `satisfies FetchHandler` on the outermost call,
 * `withOAuthProtectedResource(withSupabase(config, handler))` types
 * `ctx.oauthProtectedResource` with no annotation. The anchor is the same one
 * the engine already asks of nested stacks (it also gates collision detection
 * there): `Base` flows from the contextual return type, and without the anchor
 * the outer call resolves before it can push, so `Base` stays the empty
 * upstream and upstream keys are absent from `ctx`. Supplying `Database` explicitly
 * (`withSupabase<Db>(...)`) also defaults every later type parameter, `Base`
 * included; in that case annotate both (`withSupabase<Db, UpstreamCtx>(...)`)
 * or read the upstream key through a cast.
 *
 * @category Middleware
 *
 * @example Basic usage
 * ```ts
 * import { withSupabase } from '@supabase/server'
 *
 * export default {
 *   fetch: withSupabase({ auth: 'user' }, async (req, ctx) => {
 *     const { data } = await ctx.supabase.rpc('get_my_profile')
 *     return Response.json(data)
 *   }),
 * }
 * ```
 */
export function withSupabase<
  Database = unknown,
  Base extends BaseContext = BaseContext,
>(
  config: WithSupabaseConfig,
  // `NoInfer<Base>` blocks inference from the handler argument, leaving the
  // contextual return type as the single source of `Base` — the same split the
  // engine's `Middleware` interface documents. Without it, an annotated handler
  // supplies a candidate here that collapses `Base` to its constraint.
  handler: (
    req: Request,
    ctx: NoInfer<Base> & SupabaseContext<Database>,
  ) => Promise<Response>,
): (req: Request, ctx?: Base) => Promise<Response>

/**
 * **Alpha.** Config-only call: returns an entry for a `pipeline` array, so
 * `withSupabase` composes by position with any other middleware. Entries
 * placed before it run ahead of the auth gate and may answer unauthenticated
 * requests; entries placed after it receive the full {@link SupabaseContext}
 * and may declare prerequisites on its keys.
 *
 * The composable surface tracks `@supabase/middleware` 0.x — entry shapes and
 * context keys may change between 0.x releases. The handler-form overload is
 * stable.
 *
 * @alpha
 * @category Middleware
 *
 * @example OAuth discovery ahead of the gate, Postgres behind it
 * ```ts
 * import { pipeline } from '@supabase/middleware'
 * import { withOAuthProtectedResource, withSupabase } from '@supabase/server'
 * import { withPostgresClient } from '@supabase/server/middleware/postgres'
 *
 * export default {
 *   fetch: pipeline(
 *     [withOAuthProtectedResource(), withSupabase({ auth: 'user' }), withPostgresClient()],
 *     async (_req, ctx) => {
 *       const rows = await ctx.postgres.query`select id, body from notes`
 *       return Response.json(rows)
 *     },
 *   ),
 * }
 * ```
 */
export function withSupabase<Database = unknown>(
  config: WithSupabaseConfig,
): Entry<SupabaseContext<Database>>

export function withSupabase(
  config: WithSupabaseConfig,
  handler?: AnyHandler,
): unknown {
  if (handler === undefined) return composite(config)
  return composite(config, handler)
}
