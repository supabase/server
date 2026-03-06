import { HTTPException } from 'hono/http-exception'
import { createMiddleware } from 'hono/factory'

import { createSupabaseContext } from '../../core/create-supabase-context.js'
import type { SupabaseContext, WithSupabaseConfig } from '../../types.js'

export function supabase(config?: Omit<WithSupabaseConfig, 'cors'>) {
  return createMiddleware<{
    Variables: { supabase: SupabaseContext }
  }>(async (c, next) => {
    // Skip if a previous middleware already set the context.
    // This allows route-level overrides: a route can use supabase({ allow: 'secret' })
    // while the app-wide middleware uses supabase({ allow: 'user' }), without the
    // app-wide one overwriting the stricter context already established.
    if (c.var.supabase) {
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

    c.set('supabase', ctx)
    await next()
  })
}
