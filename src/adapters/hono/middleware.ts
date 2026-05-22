import type { Context, MiddlewareHandler, Next } from 'hono'
import { HTTPException } from 'hono/http-exception'
import { createMiddleware } from 'hono/factory'

import { createSupabaseContext } from '../../create-supabase-context.js'
import { defineAdapter } from '../../core/define-adapter.js'
import type { SupabaseContext, WithSupabaseConfig } from '../../types.js'

const adapterWithSupabase = defineAdapter<Context>({
  name: 'hono',
  extractRequest: (c) => c.req.raw,
  getExistingContext: (c) =>
    (c.var as { supabaseContext?: SupabaseContext }).supabaseContext,
  throwAuthError: (error) => {
    throw new HTTPException(error.status as 401 | 500, {
      message: error.message,
      cause: error,
    })
  },
})

/**
 * Hono middleware that creates a {@link SupabaseContext} and stores it in `c.var.supabaseContext`.
 *
 * Skips if a previous middleware already set the context, enabling route-level overrides.
 * Throws a Hono `HTTPException` on auth failure.
 *
 * @param config - Auth modes and optional environment overrides. CORS is excluded — use Hono's `cors()`.
 * @returns A Hono middleware that sets `c.var.supabaseContext`.
 *
 * @example
 * ```ts
 * import { Hono } from 'hono'
 * import { withSupabase } from '@supabase/server/adapters/hono'
 *
 * const app = new Hono()
 * app.use('*', withSupabase({ auth: 'user' }))
 *
 * app.get('/profile', async (c) => {
 *   const { supabase } = c.var.supabaseContext
 *   const { data } = await supabase.rpc('get_profile')
 *   return c.json(data)
 * })
 *
 * export default { fetch: app.fetch }
 * ```
 */
export function withSupabase(
  config?: Omit<WithSupabaseConfig, 'cors'>,
): MiddlewareHandler<{ Variables: { supabaseContext: SupabaseContext } }>
/**
 * Two-arg form — wraps the base `withSupabase` from `@supabase/server`
 * with a dual-mode handler that accepts either a plain `Request` (Web
 * Fetch) or a Hono `Context` (Hono route handler). Mount directly with
 * `app.all(path, withSupabase(config, handler))` — no manual
 * `c.req.raw` extraction needed. Use this form to compose with gates
 * from `@supabase/server/gates/*`. See
 * [gates README](../../core/gates/README.md) for the pattern.
 *
 * @example
 * ```ts
 * import { Hono } from 'hono'
 * import { withSupabase } from '@supabase/server/adapters/hono'
 * import { withFeatureFlag } from '@supabase/server/gates/feature-flag'
 *
 * const app = new Hono()
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
  config: Omit<WithSupabaseConfig, 'cors' | 'onAuthError'>,
  handler: (req: Request, ctx: SupabaseContext) => Promise<Response>,
): (input: Request | Context, next?: Next) => Promise<Response>
export function withSupabase<Database>(
  config: Omit<WithSupabaseConfig, 'cors' | 'onAuthError'>,
  handler: (req: Request, ctx: SupabaseContext<Database>) => Promise<Response>,
): (input: Request | Context, next?: Next) => Promise<Response>
export function withSupabase(
  config?: Omit<WithSupabaseConfig, 'cors' | 'onAuthError'>,
  handler?: (req: Request, ctx: SupabaseContext) => Promise<Response>,
):
  | MiddlewareHandler<{ Variables: { supabaseContext: SupabaseContext } }>
  | ((input: Request | Context, next?: Next) => Promise<Response>) {
  if (handler) return adapterWithSupabase(config!, handler)
  return createMiddleware<{
    Variables: { supabaseContext: SupabaseContext }
  }>(async (c, next) => {
    // Skip if a previous middleware already set the context.
    // This enables route-level overrides: a route can use withSupabase({ auth: 'secret' })
    // while the app-wide middleware uses withSupabase({ auth: 'user' }), without the
    // app-wide one overwriting the stricter context already established.
    if (c.var.supabaseContext) {
      await next()
      return
    }

    const { data: ctx, error } = await createSupabaseContext(c.req.raw, config)
    if (error) {
      throw new HTTPException(error.status as 401 | 500, {
        message: error.message,
        cause: error,
      })
    }

    c.set('supabaseContext', ctx)
    await next()
  })
}
