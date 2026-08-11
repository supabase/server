import { defineMiddleware } from '@supabase/middleware'
import type { Entry } from '@supabase/middleware'
import type { SupabaseClient } from '@supabase/supabase-js'

import { createAdminClient } from '../../core/create-admin-client.js'
import { CreateSupabaseClientError, EnvError, Errors } from '../../errors.js'
import type { AuthMode, CreateAdminClientOptions } from '../../types.js'

/**
 * Configuration for {@link withSupabaseAdminClient} — the same environment and
 * client options `createAdminClient` accepts, minus the per-request auth
 * identity (which is read from the upstream context).
 *
 * @category Middleware
 */
export type WithSupabaseAdminClientConfig = Omit<
  CreateAdminClientOptions,
  'auth'
>

/** Auth keys an upstream `withSupabase` seeds onto the context. @internal */
interface UpstreamAuth {
  authMode?: AuthMode
  authKeyName?: string
}

const base = defineMiddleware<
  'supabaseAdmin',
  WithSupabaseAdminClientConfig | void,
  Record<never, never>,
  SupabaseClient
>({
  key: 'supabaseAdmin',
  run: (config) => async (_req, ctx) => {
    const upstream = (ctx ?? {}) as UpstreamAuth
    // Under `withSupabase`, use the secret key the request matched; standalone
    // (or in other modes), the default secret key.
    const keyName =
      upstream.authMode === 'secret' ? upstream.authKeyName : undefined

    let supabaseAdmin: SupabaseClient
    try {
      supabaseAdmin = createAdminClient({
        auth: { keyName },
        env: config?.env,
        supabaseOptions: config?.supabaseOptions,
      })
    } catch (e) {
      throw e instanceof EnvError ? e : Errors[CreateSupabaseClientError]()
    }
    return { supabaseAdmin }
  },
})

/**
 * Contributes `ctx.supabaseAdmin` — an admin Supabase client that bypasses
 * Row-Level Security, authenticated with a secret key. This is the same
 * middleware `withSupabase` composes internally to build its context.
 *
 * @throws {@link index.EnvError} When `SUPABASE_URL` or the secret key is
 * missing — composing wrappers (like `withSupabase`) map this to a 500
 * response; standalone pipelines see it as a thrown error.
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
 * @category Middleware
 */
export function withSupabaseAdminClient<Database = unknown>(
  config?: WithSupabaseAdminClientConfig,
): Entry<'supabaseAdmin', Record<never, never>, SupabaseClient<Database>> {
  return base(config) as unknown as Entry<
    'supabaseAdmin',
    Record<never, never>,
    SupabaseClient<Database>
  >
}
