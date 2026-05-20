import type { NextFunction, Request, RequestHandler, Response } from 'express'

import { createSupabaseContext } from '../../create-supabase-context.js'
import type { AuthError } from '../../errors.js'
import type { SupabaseContext, WithSupabaseConfig } from '../../types.js'
import { toFetchRequest } from './to-fetch-request.js'

/**
 * Handler invoked when {@link withSupabase} fails to authenticate a request.
 *
 * Receives the standard Express tuple plus the {@link AuthError} produced by
 * `createSupabaseContext`. The handler owns response/next semantics: when
 * provided, the adapter will NOT call `next()` itself. If the handler throws
 * or returns a rejected promise, the thrown error is forwarded via `next(err)`
 * so Express's error pipeline still triggers.
 */
export type ExpressAuthErrorHandler = (
  error: AuthError,
  req: Request,
  res: Response,
  next: NextFunction,
) => void | Promise<void>

/**
 * Configuration for the Express adapter's {@link withSupabase} middleware.
 *
 * Mirrors {@link WithSupabaseConfig} but omits `cors` — Express applications
 * should use the `cors` npm package directly — and adds an Express-specific
 * {@link ExpressAuthErrorHandler | onError} hook.
 */
export interface WithSupabaseExpressConfig extends Omit<
  WithSupabaseConfig,
  'cors'
> {
  /**
   * Custom handler for authentication failures.
   *
   * When omitted (default), the adapter calls `next(error)` so the
   * application's error middleware can handle the {@link AuthError} — the
   * Express-idiomatic flow.
   *
   * When provided, the adapter invokes the handler instead and does NOT call
   * `next()`. The handler owns response/next semantics (e.g., `res.status(401).json(...)`).
   *
   * If the handler throws or rejects, the thrown error is forwarded via
   * `next(err)` so Express's error pipeline still triggers.
   */
  onError?: ExpressAuthErrorHandler
}

/**
 * Express 5 middleware that creates a {@link SupabaseContext} and stores it on
 * `res.locals.supabaseContext`.
 *
 * Skips if a previous middleware already set the context, enabling route-level
 * overrides. On authentication failure the configured
 * {@link WithSupabaseExpressConfig.onError | onError} handler runs; if none is
 * configured, the `AuthError` is forwarded via `next(error)` so the
 * application's error middleware can handle it.
 *
 * @param config - Auth modes, optional environment overrides, and an optional `onError` handler. CORS is excluded — use the `cors` npm package.
 * @returns An Express {@link RequestHandler}.
 *
 * @example App-wide auth
 * ```ts
 * import express from 'express'
 * import { withSupabase } from '@supabase/server/adapters/express'
 *
 * const app = express()
 * app.use(withSupabase({ auth: 'user' }))
 *
 * app.get('/profile', async (_req, res) => {
 *   const { supabase } = res.locals.supabaseContext
 *   const { data } = await supabase.rpc('get_profile')
 *   res.json(data)
 * })
 * ```
 *
 * @example Custom error handler
 * ```ts
 * app.use(
 *   withSupabase({
 *     auth: 'user',
 *     onError: (error, _req, res) => {
 *       res.status(error.status).json({ code: error.code, message: error.message })
 *     },
 *   }),
 * )
 * ```
 */
export function withSupabase(
  config?: WithSupabaseExpressConfig,
): RequestHandler {
  const onError = config?.onError
  return async (req, res, next) => {
    if (res.locals.supabaseContext) {
      next()
      return
    }

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
    next()
  }
}

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Locals {
      /**
       * Supabase context populated by {@link withSupabase}. Available on every
       * downstream handler once the middleware has run successfully.
       */
      supabaseContext: SupabaseContext
    }
  }
}
