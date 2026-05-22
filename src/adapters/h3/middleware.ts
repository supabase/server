import { defineMiddleware, HTTPError } from 'h3'
import type { Middleware } from 'h3'

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
 * Two-arg form — the base `withSupabase` from `@supabase/server`,
 * re-exported here for ergonomics. Returns a Web Fetch handler (not H3
 * middleware); mount on a route via
 * `app.all(path, (event) => handler(event.req))`. Use this form to compose
 * with gates from `@supabase/server/gates/*`. See
 * [gates README](../../core/gates/README.md) for the pattern.
 *
 * @example
 * ```ts
 * import { H3 } from 'h3'
 * import { withSupabase } from '@supabase/server/adapters/h3'
 * import { withFeatureFlag } from '@supabase/server/gates/feature-flag'
 *
 * const beta = withSupabase(
 *   { auth: 'user' },
 *   withFeatureFlag(
 *     { name: 'beta', evaluate: (req) => req.headers.has('x-beta') },
 *     async (_req, ctx) =>
 *       Response.json({ user: ctx.userClaims?.id, flag: ctx.featureFlag.name }),
 *   ),
 * )
 *
 * const app = new H3()
 * app.all('/beta', (event) => beta(event.req))
 * ```
 */
export function withSupabase(
  config: WithSupabaseConfig,
  handler: (req: Request, ctx: SupabaseContext) => Promise<Response>,
): (req: Request) => Promise<Response>
export function withSupabase<Database>(
  config: WithSupabaseConfig,
  handler: (req: Request, ctx: SupabaseContext<Database>) => Promise<Response>,
): (req: Request) => Promise<Response>
export function withSupabase(
  config?: WithSupabaseConfig,
  handler?: (req: Request, ctx: SupabaseContext) => Promise<Response>,
): Middleware | ((req: Request) => Promise<Response>) {
  if (handler) {
    const inner = withSupabaseHandler(config!, handler)
    return (req: Request) => {
      if (req instanceof Request) return inner(req)
      throw new TypeError(buildH3ArgErrorMessage(req))
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
  return (
    `withSupabase from @supabase/server/adapters/h3 returns a Web Fetch handler that expects a Request, but received ${describeH3Arg(received)}. ` +
    'Mount on an H3 route with `app.all(path, (event) => handler(event.req))`.'
  )
}

function describeH3Arg(received: unknown): string {
  if (received === null || typeof received !== 'object') return typeof received
  const r = received as { req?: unknown; context?: unknown }
  if (r.req instanceof Request && r.context !== undefined) return 'an H3Event'
  return (
    (received as { constructor?: { name?: string } }).constructor?.name ??
    'object'
  )
}
