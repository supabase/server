import type { Context, MiddlewareHandler } from 'hono'

import { createSupabaseContext } from '../../core/create-supabase-context.js'
import type { SupabaseContext, WithSupabaseConfig } from '../../types.js'

declare module 'hono' {
  interface ContextVariableMap {
    supabase: SupabaseContext
  }
}

export function supabase(
  config?: Omit<WithSupabaseConfig, 'cors'>,
): MiddlewareHandler {
  return async (c: Context, next) => {
    const { data: ctx, error } = await createSupabaseContext(c.req.raw, config)
    if (error) {
      return c.json(
        { error: error.message, code: error.code },
        error.status as 401 | 500,
      )
    }

    c.set('supabase', ctx)
    await next()
  }
}
