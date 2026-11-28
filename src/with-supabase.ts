import { defineComposite } from '@supabase/middleware'
import type { BaseContext, Composite, Entry } from '@supabase/middleware'

import { preAuthName } from './core/pre-auth.js'
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
import type {
  AuthModeWithKey,
  SupabaseContext,
  WithSupabaseConfig,
} from './types.js'

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

/** Whether every configured auth mode requires credentials, so an unauthenticated request never passes the gate. */
function requiresCredentials(config: WithSupabaseConfig): boolean {
  const modes = config.auth ?? config.allow ?? 'user'
  // `auth` keeps `'none'` out of every position but the last; the deprecated
  // `allow` still admits it anywhere, so this reads the widened element type
  // and scans the whole list.
  const list: readonly AuthModeWithKey[] = Array.isArray(modes)
    ? modes
    : [modes]
  return !list.includes('none')
}

/**
 * A pre-auth middleware behind a credentialed gate never sees the requests
 * it exists to answer. Refusing the stack at composition time is the only
 * place that failure is observable: at request time the gate has already
 * answered.
 */
function rejectPreAuthBehindGate(
  config: WithSupabaseConfig,
  handler: unknown,
): void {
  const name = preAuthName(handler)
  if (name === undefined || !requiresCredentials(config)) return
  throw new Error(
    `${name} is placed after withSupabase, whose auth gate answers unauthenticated requests before it runs, so OAuth discovery and preflight cannot be served. Place it first: pipeline([${name}(config), withSupabase(config)], handler) or ${name}(config, withSupabase(config, handler)).`,
  )
}

/** `withSupabase` composes through `pipeline` or nesting; a `middleware` key on the config has no effect and is refused so it cannot be mistaken for one. */
function rejectMiddlewareOption(config: WithSupabaseConfig): void {
  if ('middleware' in config) {
    throw new Error(
      'withSupabase has no `middleware` option. Compose entries with pipeline([withSupabase(config), ...entries], handler) from @supabase/middleware, or nest them: withSupabase(config, entry(handler)).',
    )
  }
}

function withSupabaseImpl(
  config: WithSupabaseConfig,
  handler?: AnyHandler,
): unknown {
  rejectMiddlewareOption(config)
  if (handler === undefined) {
    return (next: AnyHandler) => {
      rejectPreAuthBehindGate(config, next)
      return composite(config, next)
    }
  }
  rejectPreAuthBehindGate(config, handler)
  return composite(config, handler)
}

/** A `Database` type argument the caller did not pass. */
interface NoDatabaseArgument {
  readonly noDatabaseArgument: true
}

/**
 * `T` when the caller chose `Database`, explicitly or through a handler
 * annotation, and `never` otherwise. A call without a type argument then fails
 * the {@link DatabaseForms} signatures on its config and resolves against the
 * engine's `Composite` ones.
 */
type WhenDatabaseChosen<Database, T> = [Database] extends [NoDatabaseArgument]
  ? never
  : T

/**
 * The signatures that take a `Database` type. They come ahead of `Composite`'s,
 * so `withSupabase<Db>(...)` binds `Db` here rather than to `Composite`'s `Base`.
 */
interface DatabaseForms {
  <Database = NoDatabaseArgument, Base extends BaseContext = BaseContext>(
    config: WhenDatabaseChosen<Database, WithSupabaseConfig>,
    // `NoInfer<Base>` leaves the contextual return type as the only source of
    // `Base`, the same split the engine's `Middleware` interface documents.
    handler: (
      req: Request,
      ctx: NoInfer<Base> & SupabaseContext<Database>,
    ) => Promise<Response>,
  ): (req: Request, ctx?: Base) => Promise<Response>
  <Database = NoDatabaseArgument>(
    config: WhenDatabaseChosen<Database, WithSupabaseConfig>,
  ): Entry<SupabaseContext<Database>>
}

/**
 * The type of {@link withSupabase}: the engine's `Composite` over
 * {@link SupabaseContext}, plus signatures that take a `Database` type.
 *
 * @category Middleware
 */
export type WithSupabase = DatabaseForms &
  Composite<SupabaseContext, WithSupabaseConfig, Record<never, never>>

/**
 * Wraps a request handler with Supabase auth, client creation, and CORS handling.
 *
 * Built for the Web API `Request`/`Response` standard that all modern runtimes
 * implement natively. Handles CORS preflight, credential verification,
 * context creation, and error responses. Your handler only runs on successful auth.
 *
 * Called with a handler, `withSupabase(config, handler)` returns a fetch
 * handler. Its optional second parameter is the host's platform argument (a
 * Workers `env`, a Deno `ServeHandlerInfo`): when the runtime supplies one, it
 * is captured as the platform env behind `@supabase/middleware`'s `getEnv` for
 * any composed middleware. Nested under another middleware, it is that
 * middleware's accumulated context instead, which is reused rather than
 * reseeded. At the entry point the request body is buffered, so a nested
 * middleware and the handler can both read it.
 *
 * Called with config only, `withSupabase(config)` returns an entry for a
 * `pipeline` array. Entries placed before it run ahead of the auth gate and may
 * answer unauthenticated requests; entries placed after it receive the full
 * {@link SupabaseContext} and may declare prerequisites on its keys.
 *
 * `withSupabase` is typed with the engine's `Composite`, so it composes like
 * any middleware: nested under another middleware, the handler's `ctx` carries
 * that middleware's keys, and a key `withSupabase` contributes can't be added
 * again below it. Pass a `Database` type (`withSupabase<Database>(...)`) to
 * type `ctx.supabase` and `ctx.supabaseAdmin`; that also fixes the upstream
 * type to the empty context unless it is passed too
 * (`withSupabase<Database, UpstreamCtx>(...)`).
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
export const withSupabase: WithSupabase =
  withSupabaseImpl as unknown as WithSupabase
