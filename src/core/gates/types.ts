/**
 * Type primitives for the gate composition system.
 *
 * @packageDocumentation
 */

/**
 * The result a gate's `run` function returns: either a successful contribution
 * to be merged into `ctx.state[namespace]`, or a `Response` that short-circuits
 * the chain.
 */
export type GateResult<Contribution> =
  | { kind: 'pass'; contribution: Contribution }
  | { kind: 'reject'; response: Response }

/**
 * A gate is a value with a namespace and a `run` function. The chain composer
 * runs gates in order, threading their contributions into `ctx.state[namespace]`.
 *
 * Authors create gates via {@link defineGate}; consumers compose them via
 * {@link chain}.
 *
 * @typeParam In - Structural shape the gate requires from the upstream ctx
 * (e.g. `{ userClaims: UserClaims | null }` for a gate that reads auth).
 * Use `{}` if the gate has no prerequisites.
 * @typeParam Namespace - Literal string key under `ctx.state` where the
 * contribution lives.
 * @typeParam Contribution - Shape of the value placed at `ctx.state[Namespace]`.
 */
export interface Gate<In, Namespace extends string, Contribution> {
  readonly namespace: Namespace
  readonly run: (req: Request, ctx: In) => Promise<GateResult<Contribution>>
}

/**
 * Names that gates cannot use as their namespace, because they're either
 * reserved for the chain ctx structure (`state`, `locals`) or claimed by the
 * `withSupabase` host context.
 */
export type ReservedNamespace =
  | 'state'
  | 'locals'
  | 'supabase'
  | 'supabaseAdmin'
  | 'userClaims'
  | 'claims'
  | 'authType'
  | 'authKeyName'

/**
 * Compile-time guard: resolves to the literal namespace if it's allowed,
 * `never` otherwise. Use as the type of `defineGate`'s `namespace` field
 * to surface invalid choices as type errors.
 */
export type ValidNamespace<N extends string> = string extends N
  ? never
  : N extends ReservedNamespace
    ? never
    : N

/**
 * Strict object merge that collapses to `never` when the operands share any
 * keys. Used by `AccumulatedState` to surface namespace collisions as type
 * errors at chain composition time.
 */
export type MergeStrict<A, B> = keyof A & keyof B extends never ? A & B : never

/**
 * Accumulates the state contributions of a tuple of gates into a single
 * object type, with `MergeStrict` collision detection: if two gates declare
 * the same namespace, the result is `never` and the chain fails to compile.
 */
export type AccumulatedState<
  G extends readonly Gate<never, string, unknown>[],
> = G extends readonly [
  infer First,
  ...infer Rest extends readonly Gate<never, string, unknown>[],
]
  ? // eslint-disable-next-line @typescript-eslint/no-unused-vars
    First extends Gate<infer _In, infer N extends string, infer C>
    ? MergeStrict<{ [K in N]: C }, AccumulatedState<Rest>>
    : never
  : Record<never, never>

/**
 * The shape of `ctx` seen by a chain handler:
 * - whatever the upstream `Base` provided (e.g. `SupabaseContext` when wrapped
 *   by `withSupabase`, or `{}` standalone),
 * - plus a `state` object whose slots are the gates' contributions (read-only),
 * - plus a `locals` mutable scratch object.
 */
export type ChainCtx<Base, State> = Base & {
  readonly state: Readonly<State>
  locals: Record<string, unknown>
}
