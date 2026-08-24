import { addCorsHeaders, buildCorsHeaders, isCorsDisabled } from './cors.js'
import { verifyAuth } from './core/verify-auth.js'
import { AuthError, CreateSupabaseClientError, EnvError } from './errors.js'
import { withSupabaseAdminClient } from './middleware/admin-client/index.js'
import { withSupabaseClient } from './middleware/client/index.js'
import type { SupabaseContext, WithSupabaseConfig } from './types.js'
import { isContext, seedContext } from '@supabase/middleware'
import type { Entry } from '@supabase/middleware'

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
 * `@supabase/middleware`'s `getEnv` for any composed middleware.
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
export function withSupabase<Database = unknown>(
  config: WithSupabaseConfig & { middleware?: never },
  handler: (req: Request, ctx: SupabaseContext<Database>) => Promise<Response>,
): (req: Request, platformArg?: unknown) => Promise<Response>

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
 * the middleware array. Middleware that declare `In` prerequisites on
 * Supabase-provided keys (`supabase`, `userClaims`, …) satisfy those at runtime
 * (the Supabase context is merged before the middleware run) but not at the
 * type level — a full implementation would widen the prerequisite-validation
 * seed to include `SupabaseContext`. Ordering and collision checks within the
 * middleware array work normally via `@supabase/middleware`'s runtime chain.
 */
export function withSupabase<
  Database = unknown,
  const Entries extends readonly AnyEntry[] = readonly AnyEntry[],
>(
  config: WithSupabaseConfig & { middleware: Entries },
  handler: (
    req: Request,
    ctx: SupabaseContext<Database> & MiddlewareCtx<Entries>,
  ) => Promise<Response>,
): (req: Request, platformArg?: unknown) => Promise<Response>

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
    const corsHeaders = () =>
      !isCorsDisabled(config.cors) ? buildCorsHeaders(config.cors) : {}

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
      return Response.json(
        { message: error.message, code: error.code },
        { status: error.status, headers: corsHeaders() },
      )
    }

    // Track whether the request has moved past client construction: only
    // failures from the two client entries map to the historical JSON error
    // responses — user middleware and handler throws propagate unchanged,
    // exactly as before the rewrite.
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
      response = await composed(req, {
        ...baseContext,
        userClaims: auth.userClaims,
        jwtClaims: auth.jwtClaims,
        authMode: auth.authMode,
        authKeyName: auth.keyName ?? undefined,
      })
    } catch (e) {
      // Client construction failures keep their historical response shape:
      // EnvError (missing URL / keys) and the client middleware's
      // CreateSupabaseClientError map to the same JSON errors
      // createSupabaseContext produced.
      const mapped = !inClientPhase
        ? null
        : e instanceof EnvError
          ? new AuthError(e.message, e.code, 500)
          : e instanceof AuthError && e.code === CreateSupabaseClientError
            ? e
            : null
      if (!mapped) throw e
      return Response.json(
        { message: mapped.message, code: mapped.code },
        { status: mapped.status, headers: corsHeaders() },
      )
    }

    if (!isCorsDisabled(config.cors)) {
      return addCorsHeaders(response, config.cors)
    }
    return response
  }
}
