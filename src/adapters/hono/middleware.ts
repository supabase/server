import { HTTPException } from 'hono/http-exception'
import { createMiddleware } from 'hono/factory'

import { createSupabaseContext } from '../../create-supabase-context.js'
import type { SupabaseContext, WithSupabaseConfig } from '../../types.js'

/**
 * Hono middleware that creates a {@link SupabaseContext} and stores it in `c.var.supabaseContext`.
 *
 * This is the Hono adapter equivalent of the top-level {@link withSupabase} wrapper.
 * It handles auth and client creation, then makes the context available to all
 * downstream handlers via Hono's context variables.
 *
 * **Middleware stacking:** If a previous middleware already set `supabaseContext`,
 * this middleware is skipped. This enables route-level overrides — a route can use
 * `withSupabase({ allow: 'secret' })` while the app-wide middleware uses
 * `withSupabase({ allow: 'user' })`, without the app-wide one overwriting
 * the stricter context.
 *
 * **CORS:** The `cors` option from {@link WithSupabaseConfig} is intentionally excluded.
 * Use Hono's built-in `cors()` middleware instead.
 *
 * **Error handling:** On auth failure, throws a Hono `HTTPException` with the
 * appropriate status code, which Hono converts to an error response.
 *
 * @param config - Auth modes and optional environment overrides.
 *   The `cors` property is omitted — handle CORS with Hono's `cors()` middleware.
 *
 * @returns A Hono middleware that sets `c.var.supabaseContext`.
 *
 * @example Basic usage — protect all routes
 * ```ts
 * import { Hono } from 'hono'
 * import { withSupabase } from '@supabase/edge-functions/adapters/hono'
 *
 * const app = new Hono()
 *
 * // Apply to all routes
 * app.use('*', withSupabase({ allow: 'user' }))
 *
 * app.get('/profile', async (c) => {
 *   const { supabase, userClaims } = c.var.supabaseContext
 *   const { data } = await supabase.rpc('get_profile')
 *   return c.json({ profile: data, userId: userClaims!.id })
 * })
 *
 * export default { fetch: app.fetch }
 * ```
 *
 * @example Route-level overrides
 * ```ts
 * const app = new Hono()
 *
 * // App-wide: require authenticated user
 * app.use('*', withSupabase({ allow: 'user' }))
 *
 * // This route requires a secret key instead
 * app.post('/webhooks/stripe', withSupabase({ allow: 'secret' }), async (c) => {
 *   const { supabaseAdmin } = c.var.supabaseContext
 *   // The route-level middleware ran first, so the app-wide one is skipped
 *   return c.json({ ok: true })
 * })
 * ```
 *
 * @example Multiple auth modes
 * ```ts
 * app.use('*', withSupabase({ allow: ['user', 'public'] }))
 *
 * app.get('/items', async (c) => {
 *   const { supabase, authType } = c.var.supabaseContext
 *   // authType is 'user' or 'public' depending on the request
 *   const { data } = await supabase.rpc('list_items')
 *   return c.json(data)
 * })
 * ```
 */
export function withSupabase(config?: Omit<WithSupabaseConfig, 'cors'>) {
  return createMiddleware<{
    Variables: { supabaseContext: SupabaseContext }
  }>(async (c, next) => {
    // Skip if a previous middleware already set the context.
    // This allows route-level overrides: a route can use withSupabase({ allow: 'secret' })
    // while the app-wide middleware uses withSupabase({ allow: 'user' }), without the
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
