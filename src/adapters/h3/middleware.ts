import { defineMiddleware, HTTPError } from 'h3'

import { createSupabaseContext } from '../../create-supabase-context.js'
import type { SupabaseContext, WithSupabaseConfig } from '../../types.js'

/**
 * H3 middleware that creates a {@link SupabaseContext} and stores it in `event.context.supabaseContext`.
 *
 * Skips if a previous middleware already set the context, enabling route-level overrides.
 * Throws an `HTTPError` on auth failure.
 *
 * @param config - Auth modes and optional environment overrides. CORS is excluded — use H3's CORS utilities.
 * @returns An H3 middleware function that sets `event.context.supabaseContext`.
 *
 * @example
 * ```ts
 * import { H3 } from 'h3'
 * import { withSupabase } from '@supabase/server/adapters/h3'
 *
 * const app = new H3()
 * app.use(withSupabase({ allow: 'user' }))
 *
 * app.get('/profile', async (event) => {
 *   const { supabase } = event.context.supabaseContext
 *   const { data } = await supabase.rpc('get_profile')
 *   return Response.json(data)
 * })
 *
 * export default { fetch: app.fetch }
 * ```
 */
export function withSupabase(config?: Omit<WithSupabaseConfig, 'cors'>) {
  return defineMiddleware(async (event) => {
    // Skip if a previous middleware already set the context.
    // This allows route-level overrides: a route can use withSupabase({ allow: 'secret' })
    // while the app-wide middleware uses withSupabase({ allow: 'user' }), without the
    // app-wide one overwriting the stricter context already established.
    if (event.context.supabaseContext) {
      return
    }

    const { data: ctx, error } = await createSupabaseContext(event.req, config)
    if (error) {
      throw new HTTPError(error.message, {
        status: error.status,
        cause: error,
      })
    }

    event.context.supabaseContext = ctx
  })
}

declare module 'h3' {
  interface H3EventContext {
    supabaseContext: SupabaseContext
  }
}
