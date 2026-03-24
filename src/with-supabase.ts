import { buildCorsHeaders, addCorsHeaders } from './cors.js'
import { createSupabaseContext } from './create-supabase-context.js'
import type { SupabaseContext, WithSupabaseConfig } from './types.js'

export function withSupabase<Database = unknown>(
  config: WithSupabaseConfig,
  handler: (req: Request, ctx: SupabaseContext<Database>) => Promise<Response>,
): (req: Request) => Promise<Response> {
  return async (req: Request) => {
    if (config.cors !== false && req.method === 'OPTIONS') {
      return new Response(null, {
        status: 204,
        headers: buildCorsHeaders(config.cors),
      })
    }

    const { data: ctx, error } = await createSupabaseContext<Database>(
      req,
      config,
    )
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
