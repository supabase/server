import type { Context, MiddlewareHandler } from 'hono'
import { HTTPException } from 'hono/http-exception'
import { createMiddleware } from 'hono/factory'

import { createSupabaseContext } from '../../create-supabase-context.js'
import {
  defineAdapter,
  type AdapterWithSupabase,
} from '../../core/adapters/index.js'
import type { SupabaseContext } from '../../types.js'

/**
 * Hono adapter for `@supabase/server`.
 *
 * Exports a single overloaded `withSupabase`:
 *
 * - **One arg** — `withSupabase(config)` returns a Hono `MiddlewareHandler`
 *   that creates a {@link SupabaseContext}, stores it on
 *   `c.var.supabaseContext`, and throws a Hono `HTTPException` (carrying
 *   the original `AuthError` as `.cause`) on auth failure. Skips
 *   re-running auth if a previous middleware already set the context.
 * - **Two args** — `withSupabase(config, handler)` returns a dual-mode
 *   route handler that accepts either a plain `Request` (Web Fetch) or
 *   a Hono `Context` (Hono route handler), extracts the underlying
 *   `Request`, and runs base `withSupabase` against it. Mount directly
 *   via `app.all(path, withSupabase(config, handler))`. Use this form
 *   to compose with gates from `@supabase/server/gates/*`.
 *
 * Behavior of the two-arg form matches the one-arg middleware:
 * - **Auth failures throw `HTTPException`**, flowing into `app.onError`.
 * - **Skip-if-set** — when an upstream middleware already populated
 *   `c.var.supabaseContext`, the inner handler runs with that existing
 *   context instead of re-verifying.
 * - **CORS is excluded from the config** — use Hono's `cors()`.
 *
 * @example One-arg — app-wide auth via `app.use()`
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
 *
 * @example Two-arg — per-route auth + gates
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
export const withSupabase: AdapterWithSupabase<
  Context,
  MiddlewareHandler<{ Variables: { supabaseContext: SupabaseContext } }>
> = defineAdapter<
  Context,
  MiddlewareHandler<{ Variables: { supabaseContext: SupabaseContext } }>
>({
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
  middleware: (config) =>
    createMiddleware<{ Variables: { supabaseContext: SupabaseContext } }>(
      async (c, next) => {
        // Skip if a previous middleware already set the context.
        // This enables route-level overrides: a route can use withSupabase({ auth: 'secret' })
        // while the app-wide middleware uses withSupabase({ auth: 'user' }), without the
        // app-wide one overwriting the stricter context already established.
        if (c.var.supabaseContext) {
          await next()
          return
        }

        const { data: ctx, error } = await createSupabaseContext(
          c.req.raw,
          config,
        )
        if (error) {
          throw new HTTPException(error.status as 401 | 500, {
            message: error.message,
            cause: error,
          })
        }

        c.set('supabaseContext', ctx)
        await next()
      },
    ),
})
