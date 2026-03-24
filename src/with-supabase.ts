import { buildCorsHeaders, addCorsHeaders } from './cors.js'
import { createSupabaseContext } from './create-supabase-context.js'
import type { SupabaseContext, WithSupabaseConfig } from './types.js'

/**
 * Wraps a request handler with Supabase auth, client creation, and CORS handling.
 *
 * Built for the Web API `Request`/`Response` standard, which all modern runtimes
 * (Supabase Edge Functions, Cloudflare Workers, Deno, Bun) implement natively.
 * It handles the full lifecycle of an authenticated request:
 *
 * 1. **CORS** — Responds to `OPTIONS` preflight requests automatically (unless disabled).
 * 2. **Auth** — Extracts and verifies credentials based on the configured `allow` modes.
 * 3. **Context** — Creates RLS-scoped and admin Supabase clients.
 * 4. **Handler** — Calls your function with the request and {@link SupabaseContext}.
 * 5. **CORS headers** — Appends CORS headers to the response.
 *
 * If authentication fails, returns a JSON error response with the appropriate HTTP status
 * code — your handler is never called.
 *
 * @param config - Controls auth modes, CORS, and environment overrides.
 *   See {@link WithSupabaseConfig} for all options.
 * @param handler - Your request handler. Receives the original `Request` and a
 *   fully-initialized {@link SupabaseContext}.
 *
 * @returns A `(req: Request) => Promise<Response>` function compatible with any
 *   runtime that supports the standard `fetch` handler pattern — Supabase Edge Functions,
 *   Cloudflare Workers, Bun, Deno, and others.
 *
 * @example Basic usage — authenticated users only (default)
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
 *
 * @example Multiple auth modes — users or service-to-service
 * ```ts
 * export default {
 *   fetch: withSupabase(
 *     { allow: ['user', 'secret'] },
 *     async (req, ctx) => {
 *       if (ctx.authType === 'user') {
 *         // Handle user request with RLS
 *         const { data } = await ctx.supabase.rpc('get_my_items')
 *         return Response.json(data)
 *       }
 *       // Handle service-to-service request with admin access
 *       const { data } = await ctx.supabaseAdmin.from('items').select()
 *       return Response.json(data)
 *     },
 *   ),
 * }
 * ```
 *
 * @example Public endpoint — no auth required
 * ```ts
 * export default {
 *   fetch: withSupabase({ allow: 'always' }, async (req, ctx) => {
 *     const { data } = await ctx.supabase.rpc('get_public_stats')
 *     return Response.json(data)
 *   }),
 * }
 * ```
 *
 * @example Custom CORS headers
 * ```ts
 * export default {
 *   fetch: withSupabase(
 *     {
 *       allow: 'user',
 *       cors: {
 *         'Access-Control-Allow-Origin': 'https://myapp.com',
 *         'Access-Control-Allow-Methods': 'GET, POST',
 *         'Access-Control-Allow-Headers': 'authorization, apikey, content-type',
 *       },
 *     },
 *     async (req, ctx) => {
 *       return Response.json({ ok: true })
 *     },
 *   ),
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
