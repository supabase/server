import { createMiddleware } from 'hono/factory'

import { createSupabaseContext } from '../../core/create-supabase-context.js'
import type { SupabaseContext, WithSupabaseConfig } from '../../types.js'

export function supabase(config?: Omit<WithSupabaseConfig, 'cors'>) {
  return createMiddleware<{
    Variables: { supabase: SupabaseContext }
  }>(async (c, next) => {
    const { data: ctx, error } = await createSupabaseContext(c.req.raw, config)
    if (error) {
      return c.json(
        { error: error.message, code: error.code },
        error.status as 401 | 500,
      )
    }

    c.set('supabase', ctx)
    await next()
  })
}
