import { Elysia, type ExtractErrorFromHandle } from 'elysia'

import { createSupabaseContext } from '../../create-supabase-context.js'
import type { AuthError } from '../../errors.js'
import type { SupabaseContext, WithSupabaseConfig } from '../../types.js'

export class SupabaseError extends Error {
  status: number
  declare cause: AuthError
  constructor(inner: AuthError) {
    super(inner.message, { cause: inner })
    this.status = inner.status
  }
}

/**
 * Elysia plugin that creates a {@link SupabaseContext} and makes it available in route handlers.
 *
 * Skips if a previous plugin already set the context, enabling route-level overrides.
 * Throws a `SupabaseError` on auth failure. `.status` is on the error directly; the original
 * `AuthError` is available as the typed `.cause`. Discriminate in `onError` via `code === 'SupabaseError'`.
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
export function withSupabase(config?: Omit<WithSupabaseConfig, 'cors'>): Elysia<
  '',
  { decorator: {}; store: {}; derive: {}; resolve: {} },
  { typebox: {}; error: { readonly SupabaseError: SupabaseError } },
  {
    schema: {}
    standaloneSchema: {}
    macro: {}
    macroFn: {}
    parser: {}
    response: {}
  },
  {},
  {
    derive: {}
    resolve: { supabaseContext: SupabaseContext }
    schema: {}
    standaloneSchema: {}
    response: ExtractErrorFromHandle<{ supabaseContext: SupabaseContext }>
  },
  {
    derive: {}
    resolve: {}
    schema: {}
    standaloneSchema: {}
    response: {}
  }
> {
  return new Elysia()
    .error({ SupabaseError })
    .resolve(async (ctx): Promise<{ supabaseContext: SupabaseContext }> => {
      const existing = (ctx as { supabaseContext?: SupabaseContext })
        .supabaseContext
      if (existing) return { supabaseContext: existing }

      const { data, error } = await createSupabaseContext(ctx.request, config)
      if (error) throw new SupabaseError(error)

      return { supabaseContext: data }
    })
    .as('scoped')
}
