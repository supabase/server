import { Elysia, type ExtractErrorFromHandle } from 'elysia'

import { createSupabaseContext } from '../../create-supabase-context.js'
import type { AuthError } from '../../errors.js'
import type { SupabaseContext, WithSupabaseConfig } from '../../types.js'
import { withSupabase as withSupabaseHandler } from '../../with-supabase.js'

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
 * Two-arg form — the base `withSupabase` from `@supabase/server`,
 * re-exported here for ergonomics. Returns a Web Fetch handler (not an
 * Elysia plugin); mount on a route via
 * `.all(path, ({ request }) => handler(request))`. Use this form to
 * compose with gates from `@supabase/server/gates/*`. See
 * [gates README](../../core/gates/README.md) for the pattern.
 *
 * @example
 * ```ts
 * import { Elysia } from 'elysia'
 * import { withSupabase } from '@supabase/server/adapters/elysia'
 * import { withFeatureFlag } from '@supabase/server/gates/feature-flag'
 *
 * const beta = withSupabase(
 *   { auth: 'user' },
 *   withFeatureFlag(
 *     { name: 'beta', evaluate: (req) => req.headers.has('x-beta') },
 *     async (_req, ctx) =>
 *       Response.json({ user: ctx.userClaims?.id, flag: ctx.featureFlag.name }),
 *   ),
 * )
 *
 * new Elysia().all('/beta', ({ request }) => beta(request)).listen(3000)
 * ```
 */
export function withSupabase(
  config: WithSupabaseConfig,
  handler: (req: Request, ctx: SupabaseContext) => Promise<Response>,
): (req: Request) => Promise<Response>
export function withSupabase<Database>(
  config: WithSupabaseConfig,
  handler: (req: Request, ctx: SupabaseContext<Database>) => Promise<Response>,
): (req: Request) => Promise<Response>
export function withSupabase(
  config?: WithSupabaseConfig,
  handler?: (req: Request, ctx: SupabaseContext) => Promise<Response>,
): unknown {
  if (handler) {
    const inner = withSupabaseHandler(config!, handler)
    return (req: Request) => {
      if (req instanceof Request) return inner(req)
      throw new TypeError(buildElysiaArgErrorMessage(req))
    }
  }
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

function buildElysiaArgErrorMessage(received: unknown): string {
  return (
    `withSupabase from @supabase/server/adapters/elysia returns a Web Fetch handler that expects a Request, but received ${describeElysiaArg(received)}. ` +
    'Mount on an Elysia route with `.all(path, ({ request }) => handler(request))`.'
  )
}

function describeElysiaArg(received: unknown): string {
  if (received === null || typeof received !== 'object') return typeof received
  const r = received as { request?: unknown; set?: unknown }
  if (r.request instanceof Request && r.set !== undefined) {
    return 'an Elysia context (did you mean to destructure `{ request }`?)'
  }
  return (
    (received as { constructor?: { name?: string } }).constructor?.name ??
    'object'
  )
}
