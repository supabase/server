import type { MiddlewareHandler } from 'hono'
import { HTTPException } from 'hono/http-exception'
import { createMiddleware } from 'hono/factory'

import { createSupabaseContext } from '../../create-supabase-context.js'
import {
  AuthError,
  CreateSupabaseClientError,
  EnvError,
  Errors,
} from '../../errors.js'
import { createContextClient } from '../../core/create-context-client.js'
import { verifyUserAuth } from '../../core/verify-user-auth.js'
import type {
  SupabaseContext,
  SupabaseUserContext,
  WithSupabaseConfig,
  WithSupabaseUserAuthConfig,
} from '../../types.js'

/**
 * Hono middleware that creates a {@link SupabaseContext} and stores it in `c.var.supabaseContext`.
 *
 * Skips if a previous middleware already set the context, enabling route-level overrides.
 * Throws a Hono `HTTPException` on auth failure.
 *
 * @param config - Auth modes and optional environment overrides. CORS is excluded — use Hono's `cors()`.
 * @returns A Hono middleware that sets `c.var.supabaseContext`.
 *
 * @example
 * ```ts
 * import { Hono } from 'hono'
 * import { withSupabase } from '@supabase/server/adapters/hono'
 *
 * const app = new Hono()
 * app.use('*', withSupabase({ auth: 'user' }))
 *
 * app.get('/profile', async (c) => {
 *   const { supabase } = c.var.supabaseContext
 *   const { data } = await supabase.rpc('get_profile')
 *   return c.json(data)
 * })
 *
 * export default { fetch: app.fetch }
 * ```
 */
export function withSupabase(
  config?: Omit<WithSupabaseConfig, 'cors'>,
): MiddlewareHandler<{ Variables: { supabaseContext: SupabaseContext } }> {
  return createMiddleware<{
    Variables: { supabaseContext: SupabaseContext }
  }>(async (c, next) => {
    // Skip if a previous middleware already set the context.
    // This enables route-level overrides: a route can use withSupabase({ auth: 'secret' })
    // while the app-wide middleware uses withSupabase({ auth: 'user' }), without the
    // app-wide one overwriting the stricter context already established.
    if (c.var.supabaseContext) {
      await next()
      return
    }

    const { data: ctx, error } = await createSupabaseContext(c.req.raw, config)
    if (error) {
      throw new HTTPException(error.status as 401 | 500, {
        message: error.message,
        cause: error,
      })
    }

    c.set('supabaseContext', ctx)
    await next()
  })
}

/**
 * Hono middleware that verifies a Supabase user JWT and stores a user-scoped context.
 *
 * The context contains a Supabase client configured with the verified user's
 * bearer token, plus non-null user claims. It intentionally does not create an
 * admin client, so it does not require `SUPABASE_SECRET_KEY`.
 *
 * @param config - User auth verification and Supabase client options.
 * @returns A Hono middleware that sets `c.var.supabaseUserContext`.
 *
 * @example
 * ```ts
 * import { Hono } from 'hono'
 * import { withSupabaseUserAuth } from '@supabase/server/adapters/hono'
 *
 * const app = new Hono()
 * app.use('/api/*', withSupabaseUserAuth({ userId: expectedUserId }))
 *
 * app.get('/api/profile', async (c) => {
 *   const { supabase, userClaims } = c.var.supabaseUserContext
 *   const { data } = await supabase.from('profiles').select().eq('id', userClaims.id)
 *   return c.json(data)
 * })
 * ```
 */
export function withSupabaseUserAuth<Database = unknown>(
  config?: WithSupabaseUserAuthConfig,
): MiddlewareHandler<{
  Variables: { supabaseUserContext: SupabaseUserContext<Database> }
}> {
  return createMiddleware<{
    Variables: { supabaseUserContext: SupabaseUserContext<Database> }
  }>(async (c, next) => {
    if (c.var.supabaseUserContext) {
      await next()
      return
    }

    const { data: auth, error } = await verifyUserAuth(c.req.raw, config)
    if (error) {
      throw new HTTPException(error.status as 401 | 500, {
        message: error.message,
        cause: error,
      })
    }

    try {
      const supabase = createContextClient<Database>({
        auth: { token: auth.token },
        env: config?.env,
        supabaseOptions: config?.supabaseOptions,
      })
      c.set('supabaseUserContext', {
        supabase,
        token: auth.token,
        userClaims: auth.userClaims,
        jwtClaims: auth.jwtClaims,
      })
    } catch (e) {
      const error =
        e instanceof EnvError
          ? new AuthError(e.message, e.code, 500)
          : Errors[CreateSupabaseClientError]()
      throw new HTTPException(error.status as 401 | 500, {
        message: error.message,
        cause: error,
      })
    }

    await next()
  })
}
