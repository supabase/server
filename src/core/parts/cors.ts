import { defineMiddleware } from '@supabase/middleware'
import type { Middleware } from '@supabase/middleware'

import { addCorsHeaders, buildCorsHeaders, isCorsDisabled } from '../../cors.js'
import { ErrorCodeHeader } from '../../errors.js'
import type { WithSupabaseConfig } from '../../types.js'

/**
 * CORS for `withSupabase`, on both sides of the request.
 *
 * Request side: every `OPTIONS` request is answered with `204` and the
 * configured headers. Response side: the configured headers are stamped on
 * every response, and a response that carries `x-supabase-server-error` gets
 * that name appended to `Access-Control-Expose-Headers`, because a
 * cross-origin caller cannot read a non-safelisted header otherwise.
 * `cors: 'disabled'` turns all of this off and lets `OPTIONS` reach the
 * handler.
 *
 * Outermost part of the composite, so the gate's short-circuits and the
 * boundary's error responses pass through here on their way out.
 */
export const withSupabaseCors: Middleware<
  'supabaseCors',
  WithSupabaseConfig,
  Record<never, never>,
  Record<string, string> | null
> = defineMiddleware<
  'supabaseCors',
  WithSupabaseConfig,
  Record<never, never>,
  Record<string, string> | null
>({
  key: 'supabaseCors',
  run: (config) => {
    const disabled = isCorsDisabled(config.cors)
    const headers = disabled ? null : buildCorsHeaders(config.cors)
    return async function* (req) {
      if (disabled) {
        const passthrough: Response = yield { supabaseCors: null }
        return passthrough
      }

      if (req.method === 'OPTIONS') {
        return new Response(null, {
          status: 204,
          headers: headers ?? undefined,
        })
      }

      const response: Response = yield {
        supabaseCors: headers,
      }
      const stamped = addCorsHeaders(response, config.cors)
      if (stamped.headers.has(ErrorCodeHeader)) {
        const exposed = stamped.headers.get('Access-Control-Expose-Headers')
        const listed = exposed
          ? exposed.split(',').map((name) => name.trim().toLowerCase())
          : []
        if (!listed.includes(ErrorCodeHeader.toLowerCase())) {
          stamped.headers.set(
            'Access-Control-Expose-Headers',
            exposed ? `${exposed}, ${ErrorCodeHeader}` : ErrorCodeHeader,
          )
        }
      }
      return stamped
    }
  },
})
