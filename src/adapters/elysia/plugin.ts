import { Elysia } from 'elysia'

import { createSupabaseContext } from '../../create-supabase-context.js'
import type { SupabaseContext, WithSupabaseConfig } from '../../types.js'

class SupabaseAuthError extends Error {
  status: number
  constructor(message: string, status: number, cause: unknown) {
    super(message, { cause })
    this.status = status
  }
}

/**
 * Elysia plugin that creates a {@link SupabaseContext} and makes it available in route handlers.
 *
 * Skips if a previous plugin already set the context, enabling route-level overrides.
 * Throws an error with the correct HTTP status on auth failure. The original `AuthError` is
 * available via `error.cause` in an `onError` handler.
 *
 * @param config - Auth modes and optional environment overrides. CORS is excluded — use Elysia's CORS utilities.
 * @returns An Elysia plugin that exposes `supabaseContext`.
 *
 * @example App-wide auth via `.use()`
 * ```ts
 * import { Elysia } from 'elysia'
 * import { withSupabase } from '@supabase/server/adapters/elysia'
 *
 * const app = new Elysia()
 *   .use(withSupabase({ allow: 'user' }))
 *   .get('/games', async ({ supabaseContext }) => {
 *     const { data } = await supabaseContext.supabase.from('favorite_games').select()
 *     return data
 *   })
 *
 * app.listen(3000)
 * ```
 *
 * @example Per-route auth via scoped `.use()`
 * ```ts
 * import { Elysia } from 'elysia'
 * import { withSupabase } from '@supabase/server/adapters/elysia'
 *
 * const app = new Elysia()
 *   .get('/health', () => ({ status: 'ok' }))
 *   .group('/api', (app) =>
 *     app
 *       .use(withSupabase({ allow: 'user' }))
 *       .get('/profile', async ({ supabaseContext }) => {
 *         return supabaseContext.userClaims
 *       })
 *   )
 *
 * app.listen(3000)
 * ```
 */
export function withSupabase(config?: Omit<WithSupabaseConfig, 'cors'>) {
  return new Elysia()
    .error({ SupabaseAuthError })
    .resolve(async (ctx): Promise<{ supabaseContext: SupabaseContext }> => {
      const existing = (ctx as { supabaseContext?: SupabaseContext })
        .supabaseContext
      if (existing) return { supabaseContext: existing }

      const { data, error } = await createSupabaseContext(ctx.request, config)
      if (error) {
        throw new SupabaseAuthError(error.message, error.status, error)
      }

      return { supabaseContext: data }
    })
    .as('scoped')
}
