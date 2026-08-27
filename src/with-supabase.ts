import { addCorsHeaders, buildCorsHeaders, isCorsDisabled } from './cors.js'
import { verifyAuth } from './core/verify-auth.js'
import { errorResponse } from './error-response.js'
import {
  AuthError,
  CreateSupabaseClientError,
  EnvError,
  ErrorCodeHeader,
} from './errors.js'
import { withSupabaseAdminClient } from './middleware/admin-client/index.js'
import { withSupabaseClient } from './middleware/client/index.js'
import type {
  SupabaseContext,
  UpstreamAuth,
  WithSupabaseConfig,
} from './types.js'
import { isContext, seedContext } from '@supabase/middleware'
import type { BaseContext, Entry, ValidateEntries } from '@supabase/middleware'

type AnyEntry = Entry<string, object, unknown>
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyHandler = (req: Request, ctx: any) => Promise<Response>

/**
 * Accumulate the ctx contributions of a middleware tuple — same logic as
 * `pipeline`'s internal `Accumulate`, seeded from `object` (the engine reserves
 * no ctx keys; see implementation note below).
 */
type MiddlewareCtx<Entries extends readonly AnyEntry[]> =
  Entries extends readonly [
    Entry<infer Key extends string, object, infer Contribution>,
    ...infer Rest,
  ]
    ? Rest extends readonly AnyEntry[]
      ? { [P in Key]: Contribution } & MiddlewareCtx<Rest>
      : { [P in Key]: Contribution }
    : object

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
 * which is reused rather than reseeded.
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
 * // Without middleware — existing API, unchanged.
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
  config: WithSupabaseConfig & { middleware?: never },
  // `NoInfer<Base>` blocks inference from the handler argument, leaving the
  // contextual return type as the single source of `Base` — the same split the
  // engine's `Middleware` interface documents. Without it, an annotated handler
  // supplies a candidate here that collapses `Base` to its constraint.
  handler: (
    req: Request,
    ctx: NoInfer<Base> & SupabaseContext<Database>,
  ) => Promise<Response>,
  // `ctx?: Base` mirrors the engine's `Produced` shape for an `In`-less
  // middleware: at the top level `Base` is the empty upstream (any platform
  // argument still typechecks), and nested it is what lets the upstream
  // middleware's contribution flow inward.
): (req: Request, ctx?: Base) => Promise<Response>

/**
 * Variant that accepts a `middleware` array — each `withFoo(config)` call
 * returns an `Entry` from `@supabase/middleware`. Middleware run **after**
 * the Supabase context is established; they receive `ctx.supabase`,
 * `ctx.userClaims`, etc. already present and contribute their own typed keys
 * on top. (This is the server leg of a Plugin: the package's middleware goes
 * here; its client namespace goes in `createClient`'s `plugins` array.)
 *
 * @example
 * ```ts
 * import { withSupabase } from '@supabase/server'
 * import { withGuestbook } from '@supabase/plugin-guestbook/server'
 * import { withRateLimit } from '@supabase/plugin-rate-limit/server'
 *
 * export default {
 *   fetch: withSupabase(
 *     { auth: 'user', middleware: [withRateLimit({ rpm: 100 }), withGuestbook()] },
 *     async (req, ctx) => {
 *       ctx.supabase      // from @supabase/server
 *       ctx.rateLimit     // from withRateLimit
 *       ctx.guestbook     // from withGuestbook
 *       return Response.json(await ctx.guestbook.list())
 *     },
 *   ),
 * }
 * ```
 *
 * **Type note.** `MiddlewareCtx<Entries>` accumulates the key contributions of
 * the middleware array onto the handler's `ctx`. `ValidateEntries` checks the
 * array against the same context the entries see at runtime: the upstream
 * `Base` plus {@link SupabaseContext}. An entry may declare `In` prerequisites
 * on Supabase-provided keys (`supabase`, `jwtClaims`, and the rest). An entry
 * whose key collides with a Supabase-provided key, or with an earlier sibling,
 * fails to compile. The failure sentinel occupies the handler parameter, never
 * `entries`, so `const Entries` tuple inference stays intact, as in the
 * engine's `pipeline`.
 */
export function withSupabase<
  Database = unknown,
  const Entries extends readonly AnyEntry[] = readonly AnyEntry[],
  Base extends BaseContext = BaseContext,
>(
  config: WithSupabaseConfig & { middleware: Entries },
  // Validation sits on the handler parameter (never on `entries`) so it does
  // not disrupt `const Entries` tuple inference; the seed is the context the
  // entries actually see at runtime.
  handler: [
    ValidateEntries<Entries, Base & SupabaseContext<Database>>,
  ] extends [true]
    ? (
        req: Request,
        ctx: NoInfer<Base> & SupabaseContext<Database> & MiddlewareCtx<Entries>,
      ) => Promise<Response>
    : ValidateEntries<Entries, Base & SupabaseContext<Database>>,
): (req: Request, ctx?: Base) => Promise<Response>

export function withSupabase<Database = unknown>(
  config: WithSupabaseConfig & { middleware?: readonly AnyEntry[] },
  handler: AnyHandler,
): (req: Request, platformArg?: unknown) => Promise<Response> {
  // withSupabase runs on the engine: the context clients are the same public
  // middleware anyone can compose (`./middleware/client`,
  // `./middleware/admin-client`), folded around the user's middleware and
  // handler — the same fold as pipeline's reduceRight, but without calling
  // pipeline() so we supply the seeded ctx ourselves.
  const clientEntries: readonly AnyEntry[] = [
    withSupabaseClient<Database>({
      env: config.env,
      supabaseOptions: config.supabaseOptions,
    }) as AnyEntry,
    withSupabaseAdminClient<Database>({
      env: config.env,
      supabaseOptions: config.supabaseOptions,
    }) as AnyEntry,
  ]
  // The user's middleware and handler fold once at wrap time.
  const userComposed = (config.middleware ?? []).reduceRight<AnyHandler>(
    (h, entry) => entry(h),
    handler,
  )

  return async (req: Request, platformArg?: unknown) => {
    // Cross-origin browser code cannot read a non-safelisted response header
    // unless it is named in Access-Control-Expose-Headers, so the error code
    // header would be invisible in exactly the case it is most useful.
    const errorHeaders = () => {
      if (isCorsDisabled(config.cors)) return {}
      const headers = buildCorsHeaders(config.cors)
      const exposeKey =
        Object.keys(headers).find(
          (name) => name.toLowerCase() === 'access-control-expose-headers',
        ) ?? 'Access-Control-Expose-Headers'
      const exposed = headers[exposeKey]
      return {
        ...headers,
        [exposeKey]: exposed
          ? `${exposed}, ${ErrorCodeHeader}`
          : ErrorCodeHeader,
      }
    }

    if (!isCorsDisabled(config.cors) && req.method === 'OPTIONS') {
      return new Response(null, {
        status: 204,
        headers: buildCorsHeaders(config.cors),
      })
    }

    const { data: auth, error } = await verifyAuth(req, {
      auth: config.auth,
      allow: config.allow,
      env: config.env,
    })
    if (error) {
      return errorResponse(error, { headers: errorHeaders() })
    }

    // Track whether the request has moved past the client entries: only
    // client-phase construction failures (the `supabase` entry) map to JSON
    // error responses. User middleware and handler throws propagate
    // unchanged — including the EnvError a lazily constructed
    // `supabaseAdmin` throws at its first property access.
    let inClientPhase = true
    const markUserPhase: AnyHandler = (r, ctx) => {
      inClientPhase = false
      return userComposed(r, ctx)
    }
    const composed = clientEntries.reduceRight<AnyHandler>(
      (h, entry) => entry(h),
      markUserPhase,
    )

    let response: Response
    try {
      // As the entry point, `platformArg` is the host env — seed a context from
      // it (captured behind getEnv). Nested under another middleware, it's an
      // already-seeded context: reuse it, or reseeding would clobber the platform
      // env and drop upstream ctx keys.
      const baseContext = isContext(platformArg)
        ? platformArg
        : seedContext(platformArg)
      // The client entries read these two keys back off the context;
      // `satisfies` holds the seed to that shape without widening it.
      const upstreamAuth = {
        authMode: auth.authMode,
        authKeyName: auth.keyName ?? undefined,
      } satisfies UpstreamAuth
      response = await composed(req, {
        ...baseContext,
        userClaims: auth.userClaims,
        jwtClaims: auth.jwtClaims,
        ...upstreamAuth,
      })
    } catch (e) {
      // Client-phase construction failures map to JSON error responses:
      // EnvError (missing URL / keys) and the client middleware's
      // CreateSupabaseClientError take the same shape as the JSON errors
      // createSupabaseContext produces.
      const mapped = !inClientPhase
        ? null
        : e instanceof EnvError
          ? // Keep the EnvError's code, hint, and details — it already names
            // the exact variable at fault.
            new AuthError(e.message, e.code, 500, {
              hint: e.hint,
              details: e.details,
              docs: e.docs,
              cause: e,
            })
          : e instanceof AuthError && e.code === CreateSupabaseClientError
            ? e
            : null
      if (!mapped) throw e
      return errorResponse(mapped, { headers: errorHeaders() })
    }

    if (!isCorsDisabled(config.cors)) {
      return addCorsHeaders(response, config.cors)
    }
    return response
  }
}
