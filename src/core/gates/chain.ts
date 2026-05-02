import type { AccumulatedState, ChainCtx, Gate } from './types.js'

/**
 * Composes a tuple of gates into a function that runs them in order against
 * an inbound `Request`, then invokes the supplied handler with a context
 * containing each gate's contribution under `ctx.state[namespace]`.
 *
 * The returned function accepts an optional `baseCtx`. When invoked
 * standalone (e.g. as a fetch handler), `baseCtx` defaults to `{}`. When
 * invoked from inside `withSupabase`, the `SupabaseContext` is the baseCtx
 * and the chain handler sees `SupabaseContext & { state, locals }`.
 *
 * Type-level guarantees:
 * - **Collision detection**: two gates with the same namespace cause the
 *   accumulated state type to collapse to `never`, surfacing as a type error
 *   on the handler's `ctx.state` access.
 * - **Reserved namespaces**: gates using a reserved name (`state`, `locals`,
 *   or any `withSupabase` host key) fail at `defineGate` time.
 *
 * Runtime behaviour:
 * - Gates run sequentially; the first to return `{ kind: 'reject', response }`
 *   short-circuits the chain.
 * - Each pass-result's `contribution` is written to `ctx.state[gate.namespace]`.
 * - `ctx.locals` is initialized to an empty object that gates and the handler
 *   may mutate freely.
 *
 * @example
 * ```ts
 * import { withSupabase } from '@supabase/server'
 * import { chain } from '@supabase/server/core/gates'
 * import { withPayment } from '@supabase/server/gates'
 *
 * export default {
 *   fetch: withSupabase(
 *     { allow: 'user' },
 *     chain(withPayment({ stripe, amountCents: 5 }))(async (req, ctx) => {
 *       // ctx.supabase, ctx.userClaims        — from withSupabase
 *       // ctx.state.payment.intentId          — from withPayment
 *       // ctx.locals.foo = 'bar'              — free scratch
 *       return Response.json({ paid: ctx.state.payment.intentId })
 *     }),
 *   ),
 * }
 * ```
 */
export function chain<G extends readonly Gate<never, string, unknown>[]>(
  ...gates: G
) {
  return <Base extends object = Record<never, never>>(
    handler: (
      req: Request,
      ctx: ChainCtx<Base, AccumulatedState<G>>,
    ) => Promise<Response>,
  ): ((req: Request, baseCtx?: Base) => Promise<Response>) => {
    return async (req, baseCtx) => {
      const state: Record<string, unknown> = {}
      const locals: Record<string, unknown> = {}
      const ctx = {
        ...((baseCtx ?? {}) as Base),
        state,
        locals,
      } as ChainCtx<Base, AccumulatedState<G>>

      for (const gate of gates) {
        const result = await gate.run(req, ctx as never)
        if (result.kind === 'reject') return result.response
        state[gate.namespace] = result.contribution
      }

      return handler(req, ctx)
    }
  }
}
