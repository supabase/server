import { defineMiddleware } from '@supabase/middleware'
import type { Entry } from '@supabase/middleware'
import type { SupabaseClient } from '@supabase/supabase-js'

import { createContextClient } from '../../core/create-context-client.js'
import { extractCredentials } from '../../core/extract-credentials.js'
import { readUpstreamAuth } from '../../core/read-upstream-auth.js'
import { CreateSupabaseClientError, EnvError, Errors } from '../../errors.js'
import { markConstructionFailure } from '../../core/parts/construction-failure.js'
import type { CreateContextClientOptions } from '../../types.js'

/**
 * **Alpha.** Configuration for {@link withSupabaseClient} — the same
 * environment and client options `createContextClient` accepts, minus the
 * per-request auth identity (which is read from the request and the upstream
 * context).
 *
 * The composable middleware surface tracks `@supabase/middleware` 0.x — entry
 * shapes, context keys, and config options may change between 0.x releases.
 *
 * @alpha
 * @category Middleware
 */
export type WithSupabaseClientConfig = Omit<CreateContextClientOptions, 'auth'>

const base = defineMiddleware<
  'supabase',
  WithSupabaseClientConfig | void,
  Record<never, never>,
  SupabaseClient
>({
  key: 'supabase',
  run: (config) => async (req, ctx) => {
    const upstream = readUpstreamAuth(ctx)
    const { token: bearer } = extractCredentials(req)
    // `sb_*` secrets ride the Authorization header alongside the apikey
    // header — never attach them as a user token.
    const rawToken = bearer && !bearer.startsWith('sb_') ? bearer : undefined
    // Under `withSupabase`, mirror verified auth exactly: the bearer token is
    // attached only when it was verified (`user` mode), and the publishable
    // key is the one the request matched. Standalone, attach the raw bearer —
    // PostgREST verifies it — and use the default publishable key.
    const token =
      upstream.authMode === undefined || upstream.authMode === 'user'
        ? rawToken
        : undefined
    const keyName =
      upstream.authMode === 'publishable' ? upstream.authKeyName : undefined

    let supabase: SupabaseClient
    try {
      supabase = createContextClient({
        auth: { token, keyName },
        env: config?.env,
        supabaseOptions: config?.supabaseOptions,
      })
    } catch (e) {
      throw markConstructionFailure(
        e instanceof EnvError
          ? e
          : Errors[CreateSupabaseClientError]({ cause: e }),
      )
    }
    return { supabase }
  },
})

/**
 * **Alpha.** Contributes `ctx.supabase` — a Supabase client scoped to the
 * caller's identity, so Row-Level Security policies apply. This is the same
 * middleware `withSupabase` composes internally to build its context.
 *
 * Standalone, the caller's Bearer token (when present) is attached unverified —
 * PostgREST verifies it on every query. Compose {@link middleware/claims!withClaims}
 * upstream when the pipeline itself needs verified claims.
 *
 * @throws {@link index.EnvError} When `SUPABASE_URL` or the publishable key is
 * missing — composing wrappers (like `withSupabase`) map this to a 500
 * response; standalone pipelines see it as a thrown error.
 *
 * @example Standalone pipeline
 * ```ts
 * import { pipeline } from '@supabase/middleware'
 * import { withSupabaseClient } from '@supabase/server/middleware/client'
 *
 * export default {
 *   fetch: pipeline([withSupabaseClient()], async (req, ctx) => {
 *     const { data } = await ctx.supabase.from('posts').select('id, title')
 *     return Response.json(data)
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
export function withSupabaseClient<Database = unknown>(
  config?: WithSupabaseClientConfig,
): Entry<{ supabase: SupabaseClient<Database> }> {
  return base(config) as unknown as Entry<{
    supabase: SupabaseClient<Database>
  }>
}
