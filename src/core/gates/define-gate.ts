import type { Conflict, GateResult } from './types.js'

/**
 * Defines a gate.
 *
 * A gate is a small unit that runs against an inbound `Request` and the
 * upstream context. It either short-circuits with a `Response` (rejection) or
 * contributes a typed value at `ctx[key]` (pass), then calls the inner
 * handler with the merged context.
 *
 * The returned factory has the shape `withFoo(config, handler) → fetchHandler`,
 * so gates nest the same way `withSupabase` does — no separate composer.
 *
 * Two type-level guarantees fall out of plain TS constraints:
 *
 * - **Collision detection.** If the upstream context already has a key
 *   matching this gate's `key`, the handler position resolves to a
 *   `Conflict<…>` sentinel string and any function value fails to assign.
 *   The error surfaces at the offending gate's call site.
 * - **Prerequisite enforcement.** The `In` type parameter declares what
 *   shape the gate requires from upstream. The wrapper constrains
 *   `Base extends In`, so nesting the gate where the upstream doesn't
 *   provide those keys is a type error at the call site. Gates with `In`
 *   keys also require the caller to supply `baseCtx` — they can't be the
 *   outermost handler unless wrapped.
 *
 * @typeParam Key - The literal-string key the gate contributes to ctx.
 * Cannot collide with any key already on the upstream context.
 * @typeParam Config - Configuration object the factory accepts.
 * @typeParam In - Structural shape the gate requires from upstream.
 * Defaults to `{}` (no prerequisites). Use this to declare cross-gate
 * dependencies, e.g. `In = { supabase: SupabaseClient }`.
 * @typeParam Contribution - Shape of the value placed at `ctx[Key]`.
 *
 * @example No prerequisites:
 * ```ts
 * import { defineGate } from '@supabase/server/core/gates'
 *
 * export const withFlag = defineGate<
 *   'flag',
 *   { name: string; evaluate: (req: Request) => boolean },
 *   {},
 *   { name: string; enabled: true }
 * >({
 *   key: 'flag',
 *   run: (config) => async (req) => {
 *     if (!config.evaluate(req)) {
 *       return {
 *         kind: 'reject',
 *         response: Response.json({ error: 'feature_disabled' }, { status: 404 }),
 *       }
 *     }
 *     return { kind: 'pass', contribution: { name: config.name, enabled: true } }
 *   },
 * })
 *
 * // Standalone:
 * withFlag({ name: 'beta', evaluate: ... }, async (req, ctx) => {
 *   return Response.json({ flag: ctx.flag.name })
 * })
 * ```
 *
 * @example Depending on upstream `withSupabase`:
 * ```ts
 * export const withReportAccess = defineGate<
 *   'reportAccess',
 *   { reportId: string },
 *   { supabase: SupabaseClient; userClaims: UserClaims | null },
 *   { allowed: boolean }
 * >({
 *   key: 'reportAccess',
 *   run: (config) => async (_req, ctx) => {
 *     // ctx is typed as `{ supabase, userClaims }` — the In shape.
 *     const allowed = await canRead(ctx.supabase, ctx.userClaims, config.reportId)
 *     if (!allowed) {
 *       return {
 *         kind: 'reject',
 *         response: Response.json({ error: 'forbidden' }, { status: 403 }),
 *       }
 *     }
 *     return { kind: 'pass', contribution: { allowed } }
 *   },
 * })
 *
 * // Composes only inside `withSupabase` (or a wrapper that provides those keys):
 * withSupabase({ allow: 'user' },
 *   withReportAccess({ reportId: 'r1' }, async (req, ctx) => {
 *     ctx.supabase    // from withSupabase
 *     ctx.userClaims  // from withSupabase
 *     ctx.reportAccess // from withReportAccess
 *   })
 * )
 * ```
 */
export function defineGate<
  const Key extends string,
  Config,
  In extends object = Record<never, never>,
  Contribution = unknown,
>(spec: {
  key: Key
  run: (
    config: Config,
  ) => (req: Request, ctx: In) => Promise<GateResult<Contribution>>
}): GateFactory<Key, Config, In, Contribution> {
  return ((config: Config, handler: never) => {
    const inner = spec.run(config)
    return async (req: Request, baseCtx?: object) => {
      const upstream = baseCtx ?? ({} as object)
      const result = await inner(req, upstream as In)
      if (result.kind === 'reject') return result.response
      const ctx = { ...upstream, [spec.key]: result.contribution }
      return (
        handler as unknown as (req: Request, ctx: object) => Promise<Response>
      )(req, ctx)
    }
  }) as GateFactory<Key, Config, In, Contribution>
}

/**
 * The factory shape that {@link defineGate} produces. Two arms:
 *
 * - **No prerequisites** (`In` keys empty): `baseCtx` is optional, so the
 *   gate works as a standalone outermost handler.
 * - **With prerequisites**: `baseCtx` is required, so the gate can only be
 *   composed where another wrapper provides the upstream keys.
 */
/**
 * True when `T` is exactly `any`. The naive `0 extends 1 & T` formulation
 * doesn't fire reliably for TypeParams in deferred-conditional positions;
 * the `boolean extends (T extends never ? true : false)` form does, because
 * `any` distributes the conditional to both branches and the result becomes
 * `boolean` (which `boolean` extends).
 */
type IsAny<T> = boolean extends (T extends never ? true : false) ? true : false

/**
 * The shape of a wrapped fetch handler. Required `baseCtx` for gates with
 * prerequisites, optional otherwise.
 */
type Wrapped<Base, In> = keyof In extends never
  ? (req: Request, baseCtx?: Base) => Promise<Response>
  : (req: Request, baseCtx: Base) => Promise<Response>

/**
 * Result of calling a gate factory: either the wrapped handler (no conflict),
 * or a `Conflict<Key>` sentinel string (key already on `Base`). The sentinel
 * surfaces at the *use site* of the returned value — when it's passed as a
 * handler to an outer wrapper that expected a function, TypeScript reports
 * "Type '…' is not assignable to type 'gate-conflict: …'", citing the literal
 * conflict message.
 *
 * `any` Base (common in tests via `vi.fn` inference) skips conflict detection
 * because `keyof any` would false-positive every key.
 */
type FactoryReturn<Key extends string, Base, In> =
  IsAny<Base> extends true
    ? Wrapped<Base, In>
    : Key extends keyof Base
      ? Conflict<Key>
      : Wrapped<Base, In>

export interface GateFactory<
  Key extends string,
  Config,
  In extends object,
  Contribution,
> {
  <Base extends In>(
    config: Config,
    handler: (
      req: Request,
      ctx: Base & { [K in Key]: Contribution },
    ) => Promise<Response>,
  ): FactoryReturn<Key, Base, In>
}
