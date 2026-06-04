import { createMiddleware } from '@tanstack/start-client-core'
import type { FunctionMiddlewareAfterServer } from '@tanstack/start-client-core'
import { getRequest } from '@tanstack/start-server-core'

import { createSupabaseContext } from '../../create-supabase-context.js'
import type { SupabaseContext, WithSupabaseConfig } from '../../types.js'

// Explicit return type so JSR's "slow types" check stays happy: the inferred
// builder type is otherwise too deep to serialize. The generic slots mirror
// `createMiddleware({ type: 'function' }).server(...)` with no upstream
// middleware, validator, or client/send context: only the server context the
// `.server()` handler adds (`supabaseContext`) is populated. `{}` matches the
// `TRegister` default baked into `createMiddleware`.
/* eslint-disable @typescript-eslint/no-empty-object-type */
type SupabaseFunctionMiddleware = FunctionMiddlewareAfterServer<
  {},
  unknown,
  undefined,
  { supabaseContext: SupabaseContext },
  undefined,
  undefined,
  undefined
>
/* eslint-enable @typescript-eslint/no-empty-object-type */

/**
 * TanStack Start function middleware that creates a {@link SupabaseContext} and
 * exposes it as `context.supabaseContext` in server function handlers.
 *
 * Attach it to a server function with `.middleware([withSupabase(...)])`; the
 * context is then available (and typed) in the `.handler`. Throws the
 * package's {@link AuthError} on auth failure (carrying `.status` and `.code`),
 * which is reliably an `AuthError` instance when caught server-side (route
 * `beforeLoad`/loaders); across a client-invoked server function, TanStack's
 * RPC error serialization may flatten it to a plain error.
 *
 * @param config - Auth modes and optional environment overrides. CORS is excluded.
 * @returns A TanStack Start function middleware.
 *
 * @example
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
 */
export function withSupabase(
  config?: Omit<WithSupabaseConfig, 'cors'>,
): SupabaseFunctionMiddleware {
  return createMiddleware({ type: 'function' }).server(async ({ next }) => {
    const { data, error } = await createSupabaseContext(getRequest(), config)
    if (error) throw error
    return next({ context: { supabaseContext: data } })
  })
}
