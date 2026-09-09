import { defineMiddleware } from '@supabase/middleware'
import type { Entry } from '@supabase/middleware'
import type { SupabaseClient } from '@supabase/supabase-js'

import { createAdminClient } from '../../core/create-admin-client.js'
import { lazyClient } from '../../core/lazy-client.js'
import { readUpstreamAuth } from '../../core/read-upstream-auth.js'
import { CreateSupabaseClientError, EnvError, Errors } from '../../errors.js'
import type { CreateAdminClientOptions } from '../../types.js'

/**
 * **Alpha.** Configuration for {@link withSupabaseAdminClient} — the same
 * environment and client options `createAdminClient` accepts, minus the
 * per-request auth identity (which is read from the upstream context).
 *
 * The composable middleware surface tracks `@supabase/middleware` 0.x — entry
 * shapes, context keys, and config options may change between 0.x releases.
 *
 * @alpha
 * @category Middleware
 */
export type WithSupabaseAdminClientConfig = Omit<
  CreateAdminClientOptions,
  'auth'
>

const base = defineMiddleware<
  'supabaseAdmin',
  WithSupabaseAdminClientConfig | void,
  Record<never, never>,
  SupabaseClient
>({
  key: 'supabaseAdmin',
  run: (config) => async (_req, ctx) => {
    const upstream = readUpstreamAuth(ctx)
    // Under `withSupabase`, use the secret key the request matched; standalone
    // (or in other modes), the default secret key.
    const keyName =
      upstream.authMode === 'secret' ? upstream.authKeyName : undefined

    // Constructed on the first property access and memoized for the request —
    // a handler that never touches ctx.supabaseAdmin never resolves the
    // secret key.
    const supabaseAdmin = lazyClient<SupabaseClient>(() => {
      try {
        return createAdminClient({
          auth: { keyName },
          env: config?.env,
          supabaseOptions: config?.supabaseOptions,
        })
      } catch (e) {
        throw e instanceof EnvError
          ? e
          : Errors[CreateSupabaseClientError]({ cause: e })
      }
    })
    return { supabaseAdmin }
  },
})

/**
 * **Alpha.** Contributes `ctx.supabaseAdmin` — an admin Supabase client that
 * bypasses Row-Level Security, authenticated with a secret key. This is the
 * same middleware `withSupabase` composes internally to build its context.
 *
 * The client is constructed on the first property access of
 * `ctx.supabaseAdmin` and memoized for the request. A handler that never
 * accesses it requires no secret key.
 *
 * @throws {@link index.EnvError} When `SUPABASE_URL` or the secret key is
 * missing — thrown at the first `ctx.supabaseAdmin` property access, inside
 * the handler or downstream middleware that performs it.
 *
 * @example Standalone pipeline
 * ```ts
 * import { pipeline } from '@supabase/middleware'
 * import { withSupabaseAdminClient } from '@supabase/server/middleware/admin-client'
 *
 * export default {
 *   fetch: pipeline([withSupabaseAdminClient()], async (req, ctx) => {
 *     await ctx.supabaseAdmin.from('audit_log').insert({ action: 'ping' })
 *     return Response.json({ ok: true })
 *   }),
 * }
 * ```
 *
 * The composable middleware surface tracks `@supabase/middleware` 0.x — entry
 * shapes, context keys, and config options may change between 0.x releases.
 *
 * @alpha
 * @category Middleware
 */
export function withSupabaseAdminClient<Database = unknown>(
  config?: WithSupabaseAdminClientConfig,
): Entry<{ supabaseAdmin: SupabaseClient<Database> }> {
  return base(config) as unknown as Entry<{
    supabaseAdmin: SupabaseClient<Database>
  }>
}
