import type { Conflict } from './types.js'

/**
 * Defines a gate.
 *
 * A gate is a small unit that runs against an inbound `Request` and the
 * upstream context. It either short-circuits by returning a `Response`, or
 * contributes a typed value at `ctx[key]` by returning a single-key object
 * `{ [key]: contribution }` — the framework picks `result[key]`, merges it
 * into the context, and calls the inner handler. Any other keys on the
 * returned object are ignored at runtime, and TypeScript flags them at
 * fresh-literal returns via excess-property checks.
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
 * @typeParam Contribution - Shape of the value placed at `ctx[Key]`. The
 * `run` return type wraps this as `{ [Key]: Contribution }`, so the gate
 * author types the slot key directly in the return position.
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
 *       return Response.json({ error: 'feature_disabled' }, { status: 404 })
 *     }
 *     return { flag: { name: config.name, enabled: true } }
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
 *       return Response.json({ error: 'forbidden' }, { status: 403 })
 *     }
 *     return { reportAccess: { allowed } }
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
  ) => (
    req: Request,
    ctx: In,
  ) => Promise<Response | { [K in Key]: Contribution }>
}): GateFactory<Key, Config, In, Contribution> {
  return ((config: Config, handler: never) => {
    const inner = spec.run(config)
    return async (req: Request, baseCtx?: object) => {
      const upstream = baseCtx ?? ({} as object)
      const result = await inner(req, upstream as In)
      if (result instanceof Response) return result
      const ctx = {
        ...upstream,
        [spec.key]: (result as Record<string, unknown>)[spec.key],
      }
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
 * The shape of a wrapped fetch handler.
 *
 * Gates without prerequisites expose both signatures:
 *
 * - `(req, baseCtx)` for composition, so TypeScript can infer `Base` from the
 *   outer wrapper's handler context through nested gate calls.
 * - `(req)` for standalone handlers, preserving the ergonomic top-level use.
 *
 * A single optional `baseCtx?: Base` signature looks equivalent at runtime, but
 * it prevents the outer context from flowing into nested generic calls because
 * the parameter type becomes `Base | undefined`.
 */
type Wrapped<Base, In> = keyof In extends never
  ? ((req: Request, baseCtx: Base) => Promise<Response>) &
      ((req: Request) => Promise<Response>)
  : (req: Request, baseCtx: Base) => Promise<Response>

/**
 * Constraint that surfaces a key collision as a TypeScript error at the
 * offending gate's call site. When the upstream `Base` already has the gate's
 * `Key`, this resolves to `Conflict<Key>` (a sentinel string), which `Base`
 * (an `object`) cannot extend — TypeScript reports the conflict citing the
 * literal conflict message.
 *
 * Critically, this constraint sits next to `Base extends In` in the type
 * parameter list, *not* in the return-type or handler-parameter position. A
 * conditional type wrapping the return or handler types would block contextual
 * inference of `Base` from the outer caller. By contrast, a constraint is
 * checked but doesn't gate inference flow: TS infers `Base` from the
 * contextual handler shape first, then validates the conflict constraint.
 *
 * This is what lets nested gates pick up their upstream context types
 * automatically — no explicit `<Base>` annotations needed at each level.
 *
 * `any` Base (common in tests via `vi.fn` inference) skips the check because
 * `keyof any` would false-positive every key.
 */
type NoConflict<Key extends string, Base> =
  IsAny<Base> extends true
    ? object
    : Key extends keyof Base
      ? Conflict<Key>
      : object

export interface GateFactory<
  Key extends string,
  Config,
  In extends object,
  Contribution,
> {
  <Base extends In & NoConflict<Key, Base>>(
    config: Config,
    handler: (
      req: Request,
      ctx: Base & { [K in Key]: Contribution },
    ) => Promise<Response>,
  ): Wrapped<Base, In>
}
