import { addCorsHeaders, buildCorsHeaders, isCorsDisabled } from './cors.js'
import { createSupabaseContext } from './create-supabase-context.js'
import type { SupabaseContext, WithSupabaseConfig } from './types.js'
import type { Entry } from '@supabase/web-middleware'

type AnyEntry = Entry<string, object, unknown>
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyHandler = (req: Request, ctx: any) => Promise<Response>

/**
 * Accumulate the ctx contributions of a plugin tuple — same logic as
 * `pipeline`'s internal `Accumulate`, seeded from `object` (no `BaseContext`
 * or `_runtime` in the visible ctx type; see implementation note below).
 */
type PluginsCtx<Plugins extends readonly AnyEntry[]> =
  Plugins extends readonly [
    Entry<infer Key extends string, object, infer Contribution>,
    ...infer Rest,
  ]
    ? Rest extends readonly AnyEntry[]
      ? { [P in Key]: Contribution } & PluginsCtx<Rest>
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
 * @returns A `(req: Request) => Promise<Response>` fetch handler.
 *
 * @category Middleware
 *
 * @example Basic usage
 * ```ts
 * import { withSupabase } from '@supabase/server'
 *
 * // Without plugins — existing API, unchanged.
 * export default {
 *   fetch: withSupabase({ auth: 'user' }, async (req, ctx) => {
 *     const { data } = await ctx.supabase.rpc('get_my_profile')
 *     return Response.json(data)
 *   }),
 * }
 * ```
 */
export function withSupabase<Database = unknown>(
  config: WithSupabaseConfig & { plugins?: never },
  handler: (req: Request, ctx: SupabaseContext<Database>) => Promise<Response>,
): (req: Request) => Promise<Response>

/**
 * Variant that accepts a `plugins` array — each `withFoo(config)` call returns
 * an `Entry` from `@supabase/web-middleware`. Plugins run **after** the Supabase
 * context is established; they receive `ctx.supabase`, `ctx.userClaims`, etc.
 * already present and contribute their own typed keys on top.
 *
 * @example
 * ```ts
 * import { withSupabase } from '@supabase/server'
 * import { withGuestbook } from '@supabase/plugin-guestbook/server'
 * import { withRateLimit } from '@supabase/plugin-rate-limit/server'
 *
 * export default {
 *   fetch: withSupabase(
 *     { auth: 'user', plugins: [withRateLimit({ rpm: 100 }), withGuestbook()] },
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
 * **Type note.** `PluginsCtx<Plugins>` accumulates the key contributions of the
 * plugins array. Plugins that declare `In` prerequisites on Supabase-provided
 * keys (`supabase`, `userClaims`, …) satisfy those at runtime (the Supabase
 * context is merged before plugins run) but not at the type level — a full
 * implementation would widen the prerequisite-validation seed to include
 * `SupabaseContext`. Ordering and collision checks within the plugins array work
 * normally via `web-middleware`'s runtime chain.
 */
export function withSupabase<
  Database = unknown,
  const Plugins extends readonly AnyEntry[] = readonly AnyEntry[],
>(
  config: WithSupabaseConfig & { plugins: Plugins },
  handler: (
    req: Request,
    ctx: SupabaseContext<Database> & PluginsCtx<Plugins>,
  ) => Promise<Response>,
): (req: Request) => Promise<Response>

export function withSupabase<Database = unknown>(
  config: WithSupabaseConfig & { plugins?: readonly AnyEntry[] },
  handler: AnyHandler,
): (req: Request) => Promise<Response> {
  return async (req: Request) => {
    if (!isCorsDisabled(config.cors) && req.method === 'OPTIONS') {
      return new Response(null, {
        status: 204,
        headers: buildCorsHeaders(config.cors),
      })
    }

    const { data: ctx, error } = await createSupabaseContext<Database>(
      req,
      config,
    )
    if (error) {
      return Response.json(
        { message: error.message, code: error.code },
        {
          status: error.status,
          headers: !isCorsDisabled(config.cors)
            ? buildCorsHeaders(config.cors)
            : {},
        },
      )
    }

    let response: Response
    if (config.plugins?.length) {
      // Compose plugins around the handler — same fold as pipeline's reduceRight,
      // but without calling pipeline() so we supply the seeded ctx ourselves.
      const composed = (
        config.plugins as readonly AnyEntry[]
      ).reduceRight<AnyHandler>((h, entry) => entry(h), handler)
      // Seed _runtime so web-middleware entries recognise this as an upstream
      // context (isContext() checks for _runtime.getEnv). Falls through to
      // process.env; a full implementation would bridge to SupabaseEnv.
      const g = globalThis as {
        process?: { env?: Record<string, string | undefined> }
      }
      response = await composed(req, {
        ...ctx,
        _runtime: {
          name: 'unknown' as const,
          getEnv: (key: string): string | undefined => g.process?.env?.[key],
        },
      })
    } else {
      response = await handler(req, ctx as object)
    }

    if (!isCorsDisabled(config.cors)) {
      return addCorsHeaders(response, config.cors)
    }
    return response
  }
}
