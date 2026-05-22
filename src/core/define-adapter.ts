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
 * The one-arg framework-native middleware/plugin form is each
 * adapter's responsibility; `defineAdapter` only covers the two-arg
 * form.
 *
 * @example
 * ```ts
 * // adapters/hono/middleware.ts
 * import type { Context } from 'hono'
 * import { defineAdapter } from '../../core/define-adapter.js'
 *
 * const adapterWithSupabase = defineAdapter<Context>({
 *   name: 'hono',
 *   extractRequest: (c) => c.req.raw,
 * })
 *
 * // Then inside the implementation of the adapter's exported
 * // `withSupabase`, the two-arg branch becomes:
 * //   if (handler) return adapterWithSupabase(config, handler)
 * ```
 */
export function defineAdapter<NativeContext>(spec: AdapterSpec<NativeContext>) {
  return function withSupabase<Database = unknown>(
    config: WithSupabaseConfig,
    handler: (
      req: Request,
      ctx: SupabaseContext<Database>,
    ) => Promise<Response>,
  ): (input: Request | NativeContext) => Promise<Response> {
    const inner = baseWithSupabase<Database>(config, handler)
    return (input) => {
      if (input instanceof Request) return inner(input)
      const req = spec.extractRequest(input)
      if (req instanceof Request) return inner(req)
      throw new TypeError(buildErrorMessage(spec.name, input))
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
