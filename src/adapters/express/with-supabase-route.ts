import type { NextFunction, Request, RequestHandler, Response } from 'express'

import { createSupabaseContext } from '../../create-supabase-context.js'
import type { SupabaseContext } from '../../types.js'
import type { WithSupabaseExpressConfig } from './middleware.js'
import { toFetchRequest } from './to-fetch-request.js'

/**
 * Route handler invoked by {@link withSupabaseRoute} after authentication
 * succeeds. Receives the resolved {@link SupabaseContext} as a fourth argument
 * so the user does not need to read `res.locals`.
 */
export type SupabaseRouteHandler = (
  req: Request,
  res: Response,
  next: NextFunction,
  ctx: SupabaseContext,
) => void | Promise<void>

/**
 * Per-route wrapper that establishes a {@link SupabaseContext} for a single
 * Express route handler — an alternative to mounting {@link withSupabase} as
 * application-wide middleware.
 *
 * On success, `handler` is invoked with the standard Express tuple plus the
 * resolved context. On authentication failure, the configured
 * {@link WithSupabaseExpressConfig.onError | onError} handler runs; if none is
 * configured, the `AuthError` is forwarded via `next(error)` and `handler` is
 * NOT invoked.
 *
 * Async errors thrown by `handler` propagate via Express 5's native async
 * error handling.
 *
 * @param config - Auth modes, optional environment overrides, and an optional `onError` handler. CORS is excluded — use the `cors` npm package.
 * @param handler - Route handler invoked after auth succeeds.
 * @returns An Express {@link RequestHandler} suitable for `app.get('/path', ...)`.
 *
 * @example
 * ```ts
 * import express from 'express'
 * import { withSupabaseRoute } from '@supabase/server/adapters/express'
 *
 * const app = express()
 *
 * app.get(
 *   '/profile',
 *   withSupabaseRoute({ auth: 'user' }, async (_req, res, _next, ctx) => {
 *     const { data } = await ctx.supabase.rpc('get_profile')
 *     res.json(data)
 *   }),
 * )
 * ```
 */
export function withSupabaseRoute(
  config: WithSupabaseExpressConfig | undefined,
  handler: SupabaseRouteHandler,
): RequestHandler {
  const onError = config?.onError
  return async (req, res, next) => {
    const request = toFetchRequest(req)
    const { data: ctx, error } = await createSupabaseContext(request, config)
    if (error) {
      if (onError) {
        try {
          await onError(error, req, res, next)
        } catch (handlerError) {
          next(handlerError)
        }
        return
      }
      next(error)
      return
    }

    res.locals.supabaseContext = ctx
    await handler(req, res, next, ctx)
  }
}
