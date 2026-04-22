import { defineEventHandler, defineMiddleware, HTTPError } from 'h3'
import type { EventHandler, Middleware } from 'h3'

import { createSupabaseContext } from '../../create-supabase-context.js'
import type { SupabaseContext, WithSupabaseConfig } from '../../types.js'

type Config = Omit<WithSupabaseConfig, 'cors'>

function createAuthMiddleware(config?: Config): Middleware {
  return async (event, next) => {
    const { data: ctx, error } = await createSupabaseContext(event.req, config)
    if (error) {
      throw new HTTPError(error.message, { status: error.status, cause: error })
    }
    event.context.supabaseContext = ctx
    return next()
  }
}

/**
 * H3 middleware that creates a {@link SupabaseContext} and stores it in `event.context.supabaseContext`.
 *
 * Two forms:
 * - **Middleware form** (`app.use()`): skips if context is already set, enabling chained middleware.
 * - **Handler form** (Nuxt file routes): wraps your handler directly — no `defineEventHandler` needed.
 *
 * Throws an `HTTPError` on auth failure.
 *
 * @param config - Auth modes and optional environment overrides. CORS is excluded — use H3's CORS utilities.
 * @returns An H3 middleware (no handler) or an H3 event handler (with handler).
 *
 * @example Middleware form — app-wide auth via `app.use()`
 * ```ts
 * import { H3 } from 'h3'
 * import { withSupabase } from '@supabase/server/adapters/h3'
 *
 * const app = new H3()
 * app.use(withSupabase({ allow: 'user' }))
 *
 * app.get('/games', async (event) => {
 *   const { supabase } = event.context.supabaseContext
 *   return supabase.from('favorite_games').select()
 * })
 *
 * export default { fetch: app.fetch }
 * ```
 *
 * @example Handler form — Nuxt/Nitro file routes
 * ```ts
 * // server/api/games.get.ts
 * import { withSupabase } from '@supabase/server/adapters/h3'
 *
 * export default withSupabase({ allow: 'user' }, async (event) => {
 *   const { supabase } = event.context.supabaseContext
 *   return supabase.from('favorite_games').select()
 * })
 * ```
 */
export function withSupabase(config?: Config): Middleware
export function withSupabase(
  config: Config | undefined,
  handler: EventHandler,
): ReturnType<typeof defineEventHandler>
export function withSupabase(config?: Config, handler?: EventHandler) {
  const m = createAuthMiddleware(config)

  if (handler) {
    return defineEventHandler({ middleware: [m], handler })
  }

  // Middleware form: skip if a prior middleware already set the context.
  // Allows chaining: a second app.use(withSupabase(...)) won't overwrite the first.
  return defineMiddleware(async (event, next) => {
    if (event.context.supabaseContext) return next()
    return m(event, next)
  })
}

declare module 'h3' {
  interface H3EventContext {
    supabaseContext: SupabaseContext
  }
}
