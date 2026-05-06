import type { MiddlewareHandler } from 'hono'
import { HTTPException } from 'hono/http-exception'
import { createMiddleware } from 'hono/factory'

import { createSupabaseContext } from '../../create-supabase-context.js'
import type { SupabaseContext, WithSupabaseConfig } from '../../types.js'

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
): MiddlewareHandler<{ Variables: { supabaseContext: SupabaseContext } }> {
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
