import { defineMiddleware } from '@supabase/middleware'
import type { Middleware } from '@supabase/middleware'

import type { WithSupabaseConfig } from '../../types.js'
import {
  constructionFailureResponse,
  isConstructionFailure,
} from './construction-failure.js'

/**
 * Turns a client-construction failure thrown below it into the JSON error
 * response `withSupabase` returns for a missing URL or key.
 *
 * Every other throw propagates unchanged, including an `EnvError` raised by
 * the handler or by the first `ctx.supabaseAdmin` access: those happen after
 * the context is established and belong to the caller.
 */
export const withConstructionBoundary: Middleware<
  'supabaseBoundary',
  WithSupabaseConfig,
  Record<never, never>,
  true
> = defineMiddleware<
  'supabaseBoundary',
  WithSupabaseConfig,
  Record<never, never>,
  true
>({
  key: 'supabaseBoundary',
  run: (config) =>
    async function* () {
      try {
        const response: Response = yield { supabaseBoundary: true }
        return response
      } catch (error) {
        if (isConstructionFailure(error)) {
          return constructionFailureResponse(error, config.errors)
        }
        throw error
      }
    },
})
