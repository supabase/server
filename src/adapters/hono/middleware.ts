import { HTTPException } from 'hono/http-exception'
import { createMiddleware } from 'hono/factory'

import { createSupabaseContext } from '../../create-supabase-context.js'
import type { SupabaseContext, WithSupabaseConfig } from '../../types.js'

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
