import { Elysia, type ExtractErrorFromHandle } from 'elysia'

import { createSupabaseContext } from '../../create-supabase-context.js'
import { defineAdapter } from '../../core/adapters/index.js'
import type { AuthError } from '../../errors.js'
import type { SupabaseContext } from '../../types.js'

export class SupabaseError extends Error {
  status: number
  declare cause: AuthError
  constructor(inner: AuthError) {
    super(inner.message, { cause: inner })
    this.status = inner.status
  }
}

// The explicit Elysia plugin type below mirrors Elysia's own generic defaults,
// which use `{}` literals — switching to `object` or `Record<string, never>`
// would not satisfy the corresponding generic constraints.
/* eslint-disable @typescript-eslint/no-empty-object-type */
type SupabasePlugin = Elysia<
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
>
/* eslint-enable @typescript-eslint/no-empty-object-type */

/**
 * Elysia adapter for `@supabase/server`.
 *
 * Exports a single overloaded `withSupabase`:
 *
 * - **One arg** — `withSupabase(config)` returns an Elysia plugin that
 *   exposes `supabaseContext` via `.resolve()`. Throws a
 *   {@link SupabaseError} on auth failure; the original `AuthError` is
 *   the typed `.cause`. Skips if a previous plugin already resolved the
 *   context.
 * - **Two args** — `withSupabase(config, handler)` returns a dual-mode
 *   route handler that accepts either a plain `Request` (Web Fetch) or
 *   an Elysia route context, extracts the underlying `Request`, and
 *   runs base `withSupabase` against it. Mount directly via
 *   `.all(path, withSupabase(config, handler))`. Use this form to
 *   compose with gates from `@supabase/server/gates/*`.
 *
 * Behavior of the two-arg form matches the one-arg plugin:
 * - **Auth failures throw `SupabaseError`**, flowing into Elysia's
 *   `onError` (discriminate via `code === 'SupabaseError'`).
 * - **Skip-if-set** — when an upstream plugin already resolved
 *   `supabaseContext`, the inner handler runs with that existing
 *   context instead of re-verifying.
 * - **CORS is excluded from the config** — use Elysia's CORS plugin.
 *
 * @example One-arg — app-wide auth via `.use()`
 * ```ts
 * import { Elysia } from 'elysia'
 * import { withSupabase } from '@supabase/server/adapters/elysia'
 *
 * const app = new Elysia()
 *   .use(withSupabase({ auth: 'user' }))
 *   .get('/games', async ({ supabaseContext }) => {
 *     const { data } = await supabaseContext.supabase.from('favorite_games').select()
 *     return data
 *   })
 *
 * app.listen(3000)
 * ```
 *
 * @example Two-arg — per-route auth + gates
 * ```ts
 * import { Elysia } from 'elysia'
 * import { withSupabase } from '@supabase/server/adapters/elysia'
 * import { withFeatureFlag } from '@supabase/server/gates/feature-flag'
 *
 * new Elysia()
 *   .all(
 *     '/beta',
 *     withSupabase(
 *       { auth: 'user' },
 *       withFeatureFlag(
 *         { name: 'beta', evaluate: (req) => req.headers.has('x-beta') },
 *         async (_req, ctx) =>
 *           Response.json({ user: ctx.userClaims?.id, flag: ctx.featureFlag.name }),
 *       ),
 *     ),
 *   )
 *   .listen(3000)
 * ```
 */
export const { withSupabase } = defineAdapter<
  { request: Request; supabaseContext?: SupabaseContext },
  SupabasePlugin
>({
  name: 'elysia',
  extractRequest: (ctx) => ctx.request,
  getExistingContext: (ctx) => ctx.supabaseContext,
  throwAuthError: (error) => {
    throw new SupabaseError(error)
  },
  middleware: (config) =>
    new Elysia()
      .error({ SupabaseError })
      .resolve(async (ctx): Promise<{ supabaseContext: SupabaseContext }> => {
        const existing = (ctx as { supabaseContext?: SupabaseContext })
          .supabaseContext
        if (existing) return { supabaseContext: existing }

        const { data, error } = await createSupabaseContext(ctx.request, config)
        if (error) throw new SupabaseError(error)

        return { supabaseContext: data }
      })
      .as('scoped'),
})
