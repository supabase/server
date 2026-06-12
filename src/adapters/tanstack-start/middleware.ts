import { createMiddleware } from '@tanstack/start-client-core'
import type { RequestMiddlewareAfterServer } from '@tanstack/start-client-core'

import { createSupabaseContext } from '../../create-supabase-context.js'
import type { SupabaseContext, WithSupabaseConfig } from '../../types.js'

// Explicit return type so JSR's "slow types" check stays happy: the inferred
// builder type is otherwise too deep to serialize. The slots mirror
// `createMiddleware().server(...)` with no upstream middleware: only the
// server context the handler adds (`supabaseContext`) is populated. `{}` is the
// `TRegister` default baked into `createMiddleware`.
type SupabaseRequestMiddleware = RequestMiddlewareAfterServer<
  // eslint-disable-next-line @typescript-eslint/no-empty-object-type
  {},
  undefined,
  { supabaseContext: SupabaseContext }
>

/**
 * TanStack Start request middleware that creates a {@link SupabaseContext} and
 * exposes it as `context.supabaseContext`.
 *
 * Request middleware runs on every server request (server functions, server
 * routes, and SSR), so the same middleware covers both server functions
 * (`createServerFn().middleware([withSupabase(...)])`) and server routes
 * (`server: {{ middleware: [withSupabase(...)] }}`); in both, the context is
 * typed in the handler. Skips if a previous middleware already set the context,
 * enabling chaining without redundant auth. Throws the package's
 * {@link AuthError} on failure (carrying `.status` and `.code`).
 *
 * @param config - Auth modes and optional environment overrides. CORS is excluded.
 * @returns A TanStack Start request middleware.
 *
 * @example Server function
 * ```ts
 * import { createServerFn } from '@tanstack/react-start'
 * import { withSupabase } from '@supabase/server/adapters/tanstack-start'
 *
 * export const getProfile = createServerFn()
 *   .middleware([withSupabase({ auth: 'user' })])
 *   .handler(async ({ context }) => {
 *     const { data } = await context.supabaseContext.supabase.rpc('get_profile')
 *     return data
 *   })
 * ```
 *
 * @example Server route
 * ```ts
 * import { createFileRoute } from '@tanstack/react-router'
 * import { withSupabase } from '@supabase/server/adapters/tanstack-start'
 *
 * export const Route = createFileRoute('/api/todos')({
 *   server: {
 *     middleware: [withSupabase({ auth: 'user' })],
 *     handlers: {
 *       GET: async ({ context }) => {
 *         const { data } = await context.supabaseContext.supabase
 *           .from('todos')
 *           .select()
 *         return Response.json(data)
 *       },
 *     },
 *   },
 * })
 * ```
 */
export function withSupabase(
  config?: Omit<WithSupabaseConfig, 'cors'>,
): SupabaseRequestMiddleware {
  return createMiddleware().server(async ({ request, context, next }) => {
    // Skip if a previous middleware already resolved the context. This enables
    // chaining without re-running auth, and keeps the first-established context
    // (the first middleware to run wins, matching the Hono/H3 adapters).
    const existing = (
      context as unknown as { supabaseContext?: SupabaseContext }
    ).supabaseContext
    if (existing) return next({ context: { supabaseContext: existing } })

    const { data, error } = await createSupabaseContext(request, config)
    if (error) throw error

    return next({ context: { supabaseContext: data } })
  })
}
