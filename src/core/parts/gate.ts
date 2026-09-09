import { defineMiddleware } from '@supabase/middleware'
import type { Middleware } from '@supabase/middleware'

import { errorResponse } from '../../error-response.js'
import type { SupabaseContext, WithSupabaseConfig } from '../../types.js'
import { verifyAuth } from '../verify-auth.js'

/**
 * The verified identity for one request, as a single value. The projections
 * in `./projections.ts` republish each field as its own `ctx` key; this
 * bundle itself stays internal to the composite.
 */
export type AuthGateContribution = Pick<
  SupabaseContext,
  'userClaims' | 'jwtClaims' | 'authMode'
> & { authKeyName: string | undefined }

/**
 * The auth gate. Verifies the request's credentials against `config.auth`
 * (or the deprecated `config.allow`) and short-circuits with the JSON error
 * response when they fail. CORS headers are the CORS part's job, so the
 * short-circuit carries only the error body and the error-code header.
 */
export const withAuthGate: Middleware<
  'supabaseAuth',
  WithSupabaseConfig,
  Record<never, never>,
  AuthGateContribution
> = defineMiddleware<
  'supabaseAuth',
  WithSupabaseConfig,
  Record<never, never>,
  AuthGateContribution
>({
  key: 'supabaseAuth',
  run: (config) => async (req) => {
    const { data, error } = await verifyAuth(req, {
      auth: config.auth,
      allow: config.allow,
      env: config.env,
    })
    if (error) return errorResponse(error, { errors: config.errors })
    return {
      supabaseAuth: {
        userClaims: data.userClaims,
        jwtClaims: data.jwtClaims,
        authMode: data.authMode,
        authKeyName: data.keyName ?? undefined,
      },
    }
  },
})
