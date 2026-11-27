import { defineComposite } from '@supabase/middleware'
import type {
  BaseContext,
  Composite,
  Contributions,
  Entry,
} from '@supabase/middleware'

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
  UntypedDatabase,
  WithSupabaseConfig,
} from './types.js'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyHandler = (req: Request, ctx: any) => Promise<Response>

/**
 * The parts `withSupabase` is made of, outermost first, with both clients
 * typed for `Database`. Each contributes one key; the composite derives its
 * contributions from them and keeps `supabaseCors`, `supabaseBoundary` and
 * `supabaseAuth` internal, so the handler sees exactly {@link SupabaseContext}.
 *
 * Order is load-bearing: the CORS part must see every response on the way
 * out, the boundary must sit above the client parts whose construction
 * errors it maps, the gate must run before the projections that read its
 * result, and the projections must run before the client parts, which read
 * the flat `authMode` / `authKeyName` keys to mirror the matched credential.
 */
function supabaseComposite<Database>() {
  return defineComposite({
    build: (config: WithSupabaseConfig) =>
      [
        withSupabaseCors(config),
        withConstructionBoundary(config),
        withAuthGate(config),
        withUserClaims(),
        withJwtClaims(),
        withAuthMode(),
        withAuthKeyName(),
        withSupabaseClient<Database>({
          env: config.env,
          supabaseOptions: config.supabaseOptions,
        }),
        withSupabaseAdminClient<Database>({
          env: config.env,
          supabaseOptions: config.supabaseOptions,
        }),
      ] as const,
    internal: ['supabaseCors', 'supabaseBoundary', 'supabaseAuth'],
  })
}

/**
 * `createWithSupabase`'s return statement checks that every key its declared
 * type names is one the parts contribute, with the same type. This checks the
 * reverse: a public key the parts contribute but the declaration leaves out
 * would escape the collision checks.
 */
type Contributed = Contributions<
  [ReturnType<ReturnType<typeof supabaseComposite>>]
>
const everyKeyDeclared: [
  Exclude<keyof Contributed, keyof SupabaseContext>,
] extends [never]
  ? true
  : false = true
void everyKeyDeclared

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

/**
 * Runs the two construction-time checks before the composite builds: on the
 * config at the call, and on the downstream handler once it is known, which
 * for a `pipeline` entry is when the array folds. The composite's type passes
 * through unchanged.
 */
function withChecks<C>(composite: C): C {
  const build = composite as unknown as (
    config: WithSupabaseConfig,
    handler: AnyHandler,
  ) => AnyHandler
  const checked = (config: WithSupabaseConfig, handler?: AnyHandler) => {
    rejectMiddlewareOption(config)
    if (handler === undefined) {
      return (next: AnyHandler) => {
        rejectPreAuthBehindGate(config, next)
        return build(config, next)
      }
    }
    rejectPreAuthBehindGate(config, handler)
    return build(config, handler)
  }
  return checked as unknown as C
}

/**
 * Creates a {@link withSupabase} whose clients are typed for your `Database`,
 * like `createClient<Database>()` in `@supabase/supabase-js`. Call it once at
 * module scope, then use the result wherever you use `withSupabase`: nested
 * around a handler or another middleware, or as a `pipeline` entry.
 *
 * The result is a `Composite` from `@supabase/middleware`, built from the same
 * parts as `withSupabase` and with the same runtime behavior. Being the
 * engine's own type, it gets the engine's checks: a middleware that
 * contributes one of its keys again below it fails to compile, in a `pipeline`
 * and in a nested stack anchored with `satisfies FetchHandler`.
 *
 * @typeParam Database - Your generated database types, from
 * `supabase gen types typescript`. `ctx.supabase` and `ctx.supabaseAdmin` are
 * typed `SupabaseClient<Database>`.
 *
 * @category Middleware
 *
 * @example
 * ```ts
 * import { createWithSupabase } from '@supabase/server'
 *
 * // `Database` is the type `supabase gen types typescript` generates.
 * const withSupabase = createWithSupabase<Database>()
 *
 * export default {
 *   fetch: withSupabase({ auth: 'user' }, async (_req, ctx) => {
 *     // ctx.supabase is SupabaseClient<Database>
 *     const { data } = await ctx.supabase.from('todos').select('id, title')
 *     return Response.json(data)
 *   }),
 * }
 * ```
 */
export function createWithSupabase<Database = UntypedDatabase>(): Composite<
  SupabaseContext<Database>,
  WithSupabaseConfig,
  Record<never, never>
> {
  return withChecks(supabaseComposite<Database>())
}

const untypedWithSupabase = createWithSupabase()

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
 * upstream and upstream keys are absent from `ctx`.
 *
 * @typeParam Database - Deprecated: choose it once with
 * {@link createWithSupabase} instead. Supplied here (`withSupabase<Db>(...)`),
 * it also defaults every later type parameter, `Base` included, so upstream
 * keys are absent from `ctx`.
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
  Database = UntypedDatabase,
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
 * Config-only call: returns an entry for a `pipeline` array, so
 * `withSupabase` composes by position with any other middleware. Entries
 * placed before it run ahead of the auth gate and may answer unauthenticated
 * requests; entries placed after it receive the full {@link SupabaseContext}
 * and may declare prerequisites on its keys.
 *
 * @typeParam Database - Deprecated: choose it once with
 * {@link createWithSupabase} instead.
 *
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
export function withSupabase<Database = UntypedDatabase>(
  config: WithSupabaseConfig,
): Entry<SupabaseContext<Database>>

export function withSupabase(
  config: WithSupabaseConfig,
  handler?: AnyHandler,
): unknown {
  return handler === undefined
    ? untypedWithSupabase(config)
    : untypedWithSupabase(config, handler)
}
