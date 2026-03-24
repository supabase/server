import { buildCorsHeaders, addCorsHeaders } from './cors.js'
import { createSupabaseContext } from './create-supabase-context.js'
import type { SupabaseContext, WithSupabaseConfig } from './types.js'

/**
 * Wraps a request handler with Supabase auth, client creation, and CORS handling.
 *
 * Built for the Web API `Request`/`Response` standard that all modern runtimes
 * implement natively. Handles CORS preflight, credential verification,
 * context creation, and error responses. Your handler only runs on successful auth.
 *
 * @param config - Auth modes, CORS, and environment overrides. See {@link WithSupabaseConfig}.
 * @param handler - Receives the `Request` and a fully-initialized {@link SupabaseContext}.
 * @returns A `(req: Request) => Promise<Response>` fetch handler.
 *
 * @example
 * ```ts
 * import { withSupabase } from '@supabase/server'
 *
 * export default {
 *   fetch: withSupabase({ allow: 'user' }, async (req, ctx) => {
 *     const { data } = await ctx.supabase.rpc('get_my_profile')
 *     return Response.json(data)
 *   }),
 * }
 * ```
 */
export function withSupabase(
  config: WithSupabaseConfig,
  handler: (req: Request, ctx: SupabaseContext) => Promise<Response>,
): (req: Request) => Promise<Response> {
  return async (req: Request) => {
    if (config.cors !== false && req.method === 'OPTIONS') {
      return new Response(null, {
        status: 204,
        headers: buildCorsHeaders(config.cors),
      })
    }

    const { data: ctx, error } = await createSupabaseContext(req, config)
    if (error) {
      return Response.json(
        { error: error.message, code: error.code },
        {
          status: error.status,
          headers: config.cors !== false ? buildCorsHeaders(config.cors) : {},
        },
      )
    }

    const response = await handler(req, ctx)

    if (config.cors !== false) {
      return addCorsHeaders(response, config.cors)
    }
    return response
  }
}
