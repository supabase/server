import { Elysia, type ExtractErrorFromHandle } from 'elysia'

import { createSupabaseContext } from '../../create-supabase-context.js'
import { defineAdapter } from '../../core/define-adapter.js'
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

const adapterWithSupabase = defineAdapter<{
  request: Request
  supabaseContext?: SupabaseContext
}>({
  name: 'elysia',
  extractRequest: (ctx) => ctx.request,
  getExistingContext: (ctx) => ctx.supabaseContext,
  throwAuthError: (error) => {
    throw new SupabaseError(error)
  },
})

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
// The explicit return type below mirrors Elysia's own generic defaults, which use
// `{}` literals — switching to `object` or `Record<string, never>` would not satisfy
// the corresponding generic constraints.
/* eslint-disable @typescript-eslint/no-empty-object-type */
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
>
/* eslint-enable @typescript-eslint/no-empty-object-type */
/**
 * Two-arg form — a dual-mode route handler that accepts either a plain
 * `Request` (Web Fetch) or an Elysia route context, extracts the
 * underlying Request, and runs base `withSupabase` against it. Mount
 * directly with `.all(path, withSupabase(config, handler))` — no
 * `{ request }` destructuring needed. Use this form to compose with
 * gates from `@supabase/server/gates/*`. See
 * [gates README](../../core/gates/README.md) for the pattern.
 *
 * Behavior matches the one-arg plugin form:
 * - **Auth failures throw `SupabaseError`**, flowing into Elysia's
 *   `onError` (not returned as a JSON response). Discriminate via
 *   `code === 'SupabaseError'`; the original {@link AuthError} is on
 *   `.cause` and `.status` is on the error directly.
 * - **Skips re-running auth when an upstream plugin has already
 *   resolved `supabaseContext`** — the inner handler runs with that
 *   existing context. Useful when `.use(withSupabase(...))` is wired
 *   app-wide and a route adds gates on top.
 * - **CORS is excluded from the config** (`Omit<…, 'cors'>`). Use
 *   Elysia's CORS plugin.
 *
 * @example
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
export function withSupabase(
  config: Omit<WithSupabaseConfig, 'cors' | 'onAuthError'>,
  handler: (req: Request, ctx: SupabaseContext) => Promise<Response>,
): (input: Request | { request: Request }) => Promise<Response>
export function withSupabase<Database>(
  config: Omit<WithSupabaseConfig, 'cors' | 'onAuthError'>,
  handler: (req: Request, ctx: SupabaseContext<Database>) => Promise<Response>,
): (input: Request | { request: Request }) => Promise<Response>
export function withSupabase(
  config?: Omit<WithSupabaseConfig, 'cors' | 'onAuthError'>,
  handler?: (req: Request, ctx: SupabaseContext) => Promise<Response>,
): unknown {
  if (handler) return adapterWithSupabase(config!, handler)
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
