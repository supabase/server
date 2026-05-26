import { defineMiddleware, HTTPError } from 'h3'
import type { H3Event, Middleware } from 'h3'

import { createSupabaseContext } from '../../create-supabase-context.js'
import { defineAdapter } from '../../core/adapters/index.js'
import type { SupabaseContext } from '../../types.js'

/**
 * H3 adapter for `@supabase/server`.
 *
 * Exports a single overloaded `withSupabase`:
 *
 * - **One arg** — `withSupabase(config)` returns an H3 `Middleware` that
 *   creates a {@link SupabaseContext}, stores it on
 *   `event.context.supabaseContext`, and throws an `HTTPError` (carrying
 *   the original `AuthError` as `.cause`) on auth failure. Skips
 *   re-running auth if a previous middleware already set the context.
 * - **Two args** — `withSupabase(config, handler)` returns a dual-mode
 *   route handler that accepts either a plain `Request` (Web Fetch) or
 *   an `H3Event` (H3 route handler), extracts the underlying `Request`,
 *   and runs base `withSupabase` against it. Mount directly via
 *   `app.all(path, withSupabase(config, handler))`. Use this form to
 *   compose with gates from `@supabase/server/gates/*`.
 *
 * Behavior of the two-arg form matches the one-arg middleware:
 * - **Auth failures throw `HTTPError`**, flowing into H3's `onError` hook.
 * - **Skip-if-set** — when an upstream middleware already populated
 *   `event.context.supabaseContext`, the inner handler runs with that
 *   existing context instead of re-verifying.
 * - **CORS is excluded from the config** — use H3's CORS utilities.
 *
 * @example One-arg — app-wide auth via `app.use()`
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
 * @example Two-arg — per-route auth + gates
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
export const { withSupabase } = defineAdapter<H3Event, Middleware>({
  name: 'h3',
  extractRequest: (event) => event.req,
  getExistingContext: (event) =>
    (event.context as { supabaseContext?: SupabaseContext }).supabaseContext,
  throwAuthError: (error) => {
    throw new HTTPError(error.message, { status: error.status, cause: error })
  },
  middleware: (config) =>
    defineMiddleware(async (event, next) => {
      const context = event.context as { supabaseContext?: SupabaseContext }
      if (context.supabaseContext) return next()
      const { data: ctx, error } = await createSupabaseContext(
        event.req,
        config,
      )
      if (error) {
        throw new HTTPError(error.message, {
          status: error.status,
          cause: error,
        })
      }
      context.supabaseContext = ctx
      return next()
    }),
})
