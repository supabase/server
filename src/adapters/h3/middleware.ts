import { defineMiddleware, HTTPError } from 'h3'
import type { H3Event, Middleware } from 'h3'

import { createSupabaseContext } from '../../create-supabase-context.js'
import type { SupabaseContext, WithSupabaseConfig } from '../../types.js'
import { withSupabase as withSupabaseHandler } from '../../with-supabase.js'

/**
 * H3 middleware that creates a {@link SupabaseContext} and stores it in `event.context.supabaseContext`.
 *
 * Skips if a previous middleware already set the context, enabling chained middleware via `app.use()`.
 * Throws an `HTTPError` on auth failure.
 *
 * @param config - Auth modes and optional environment overrides. CORS is excluded — use H3's CORS utilities.
 * @returns An H3 middleware.
 *
 * @example App-wide auth via `app.use()`
 * ```ts
 * import { H3 } from 'h3'
 * import { withSupabase } from '@supabase/server/adapters/h3'
 *
 * const app = new H3()
 * app.use(withSupabase({ auth: 'user' }))
 *
 * app.get('/games', async (event) => {
 *   const { supabase } = event.context.supabaseContext
 *   return supabase.from('favorite_games').select()
 * })
 *
 * export default { fetch: app.fetch }
 * ```
 *
 * @example Per-route auth via `defineHandler`
 * ```ts
 * import { defineHandler } from 'h3'
 * import { withSupabase } from '@supabase/server/adapters/h3'
 *
 * export default defineHandler({
 *   middleware: [withSupabase({ auth: 'user' })],
 *   handler: async (event) => {
 *     const { supabase } = event.context.supabaseContext
 *     return supabase.from('favorite_games').select()
 *   },
 * })
 * ```
 */
export function withSupabase(
  config?: Omit<WithSupabaseConfig, 'cors'>,
): Middleware
/**
 * Two-arg form — wraps the base `withSupabase` from `@supabase/server`
 * with a dual-mode handler that accepts either a plain `Request` (Web
 * Fetch) or an H3 `H3Event` (H3 route handler). Mount directly with
 * `app.all(path, withSupabase(config, handler))` — no manual `event.req`
 * extraction needed. Use this form to compose with gates from
 * `@supabase/server/gates/*`. See
 * [gates README](../../core/gates/README.md) for the pattern.
 *
 * @example
 * ```ts
 * import { H3 } from 'h3'
 * import { withSupabase } from '@supabase/server/adapters/h3'
 * import { withFeatureFlag } from '@supabase/server/gates/feature-flag'
 *
 * const app = new H3()
 *
 * app.all(
 *   '/beta',
 *   withSupabase(
 *     { auth: 'user' },
 *     withFeatureFlag(
 *       { name: 'beta', evaluate: (req) => req.headers.has('x-beta') },
 *       async (_req, ctx) =>
 *         Response.json({ user: ctx.userClaims?.id, flag: ctx.featureFlag.name }),
 *     ),
 *   ),
 * )
 * ```
 */
export function withSupabase(
  config: WithSupabaseConfig,
  handler: (req: Request, ctx: SupabaseContext) => Promise<Response>,
): (input: Request | H3Event) => Promise<Response>
export function withSupabase<Database>(
  config: WithSupabaseConfig,
  handler: (req: Request, ctx: SupabaseContext<Database>) => Promise<Response>,
): (input: Request | H3Event) => Promise<Response>
export function withSupabase(
  config?: WithSupabaseConfig,
  handler?: (req: Request, ctx: SupabaseContext) => Promise<Response>,
): Middleware | ((input: Request | H3Event) => Promise<Response>) {
  if (handler) {
    const inner = withSupabaseHandler(config!, handler)
    return (input: Request | H3Event) => {
      if (input instanceof Request) return inner(input)
      if (input?.req instanceof Request) return inner(input.req)
      throw new TypeError(buildH3ArgErrorMessage(input))
    }
  }
  return defineMiddleware(async (event, next) => {
    const context = event.context as { supabaseContext?: SupabaseContext }
    if (context.supabaseContext) return next()
    const { data: ctx, error } = await createSupabaseContext(event.req, config)
    if (error) {
      throw new HTTPError(error.message, { status: error.status, cause: error })
    }
    context.supabaseContext = ctx
    return next()
  })
}

function buildH3ArgErrorMessage(received: unknown): string {
  const what =
    received === null || typeof received !== 'object'
      ? typeof received
      : ((received as { constructor?: { name?: string } }).constructor?.name ??
        'object')
  return (
    `withSupabase from @supabase/server/adapters/h3 expected a Request or an H3Event, but received ${what}. ` +
    'Mount with `app.all(path, withSupabase(config, handler))`.'
  )
}
