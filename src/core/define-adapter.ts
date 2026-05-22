import type { AuthError } from '../errors.js'
import type { SupabaseContext, WithSupabaseConfig } from '../types.js'
import { withSupabase as baseWithSupabase } from '../with-supabase.js'

/**
 * Spec for {@link defineAdapter}.
 *
 * @template NativeContext - The framework's native route-handler input
 *   (e.g. Hono's `Context`, H3's `H3Event`, Elysia's route args). The
 *   produced `withSupabase` accepts `Request | NativeContext` and
 *   extracts the underlying Request via {@link extractRequest}.
 */
export interface AdapterSpec<NativeContext> {
  /** Adapter name, surfaced in error messages (e.g. `'hono'`). */
  name: string

  /**
   * Returns the underlying `Request` carried by the framework's native
   * route input. Should return `undefined` when the input isn't
   * recognized as a `NativeContext` — `defineAdapter` will then throw
   * a `TypeError` naming the adapter.
   */
  extractRequest: (input: NativeContext) => Request | undefined

  /**
   * Returns an existing {@link SupabaseContext} already attached to the
   * framework's native input by an upstream middleware/plugin (e.g.
   * `c.var.supabaseContext` for Hono). When this returns a value, the
   * two-arg form skips base auth and invokes the inner handler
   * directly with the existing context — matching the
   * skip-if-already-set behavior of the one-arg middleware form.
   *
   * Omit to disable skip behavior (every two-arg call runs base auth).
   */
  getExistingContext?: (input: NativeContext) => SupabaseContext | undefined

  /**
   * Maps an `AuthError` from base auth into a framework-native error
   * thrown into the framework's error pipeline (e.g. Hono's
   * `HTTPException` → `onError`). Must throw — return type is `never`
   * and any returned value is ignored.
   *
   * When provided, passed as `onAuthError` to base on every two-arg
   * call. Omit to fall back to base's default JSON error response.
   */
  throwAuthError?: (error: AuthError) => never
}

/**
 * Build the two-arg `withSupabase` form for a framework adapter.
 *
 * The returned function accepts either a plain `Request` (Web Fetch
 * use) or the framework's native route input (`NativeContext`),
 * extracts the underlying Request, and runs base `withSupabase`
 * against it. This lets the adapter's two-arg form be mounted directly
 * on the framework's route registrar — e.g.
 * `app.all(path, withSupabase(config, handler))` — without a wrapping
 * arrow that extracts `c.req.raw` / `event.req` / `ctx.request`.
 *
 * CORS is forced **off** on the underlying base call (`cors: false`):
 * the two-arg form's config type excludes `cors`, and any CORS
 * handling is the framework's responsibility (same as the one-arg
 * middleware/plugin form). This keeps the two surfaces consistent —
 * a user who wires up the framework's CORS app-wide never gets
 * double-handled or duplicate CORS headers from a gated route.
 *
 * Optional spec hooks unify additional behavior with the one-arg
 * form:
 *
 * - {@link AdapterSpec.getExistingContext} — skip base auth when a
 *   prior middleware already set `c.var.supabaseContext` (or
 *   equivalent).
 * - {@link AdapterSpec.throwAuthError} — surface auth failures
 *   through the framework's error pipeline.
 *
 * The one-arg framework-native middleware/plugin form is each
 * adapter's responsibility; `defineAdapter` only covers the two-arg
 * form.
 *
 * @example
 * ```ts
 * // adapters/hono/middleware.ts
 * import type { Context } from 'hono'
 * import { HTTPException } from 'hono/http-exception'
 * import { defineAdapter } from '../../core/define-adapter.js'
 *
 * const adapterWithSupabase = defineAdapter<Context>({
 *   name: 'hono',
 *   extractRequest: (c) => c.req.raw,
 *   getExistingContext: (c) => c.var.supabaseContext,
 *   throwAuthError: (error) => {
 *     throw new HTTPException(error.status as 401 | 500, {
 *       message: error.message,
 *       cause: error,
 *     })
 *   },
 * })
 * ```
 */
export function defineAdapter<NativeContext>(spec: AdapterSpec<NativeContext>) {
  return function withSupabase<Database = unknown>(
    config: Omit<WithSupabaseConfig, 'cors' | 'onAuthError'>,
    handler: (
      req: Request,
      ctx: SupabaseContext<Database>,
    ) => Promise<Response>,
  ): (input: Request | NativeContext) => Promise<Response> {
    const baseConfig: WithSupabaseConfig = {
      ...config,
      cors: false,
      ...(spec.throwAuthError ? { onAuthError: spec.throwAuthError } : {}),
    }
    const inner = baseWithSupabase<Database>(baseConfig, handler)

    return (input) => {
      if (input instanceof Request) return inner(input)

      const req = spec.extractRequest(input)
      if (!(req instanceof Request)) {
        throw new TypeError(buildErrorMessage(spec.name, input))
      }

      const existing = spec.getExistingContext?.(input)
      if (existing) {
        return handler(req, existing as SupabaseContext<Database>)
      }

      return inner(req)
    }
  }
}

function buildErrorMessage(name: string, received: unknown): string {
  const what =
    received === null || typeof received !== 'object'
      ? typeof received
      : ((received as { constructor?: { name?: string } }).constructor?.name ??
        'object')
  return (
    `withSupabase from @supabase/server/adapters/${name} expected a Request or a ${name} route context, ` +
    `but received ${what}. Mount with \`app.all(path, withSupabase(config, handler))\` (or the equivalent for your framework).`
  )
}
