/**
 * Type primitives for the gate composition system.
 *
 * @packageDocumentation
 */

/**
 * The result a gate's `run` function returns: either a successful contribution
 * to be merged into `ctx[key]`, or a `Response` that short-circuits.
 */
export type GateResult<Contribution> =
  | { kind: 'pass'; contribution: Contribution }
  | { kind: 'reject'; response: Response }

/**
 * Sentinel type used in a gate's wrapper signature to surface a key collision
 * with the upstream context as a TypeScript error at the gate's call site.
 *
 * The literal string is part of the type so it appears in the error message
 * (TypeScript prints "Type '…' is not assignable to type 'gate-conflict: …'").
 */
export type Conflict<Key extends string> =
  `gate-conflict: key '${Key}' is already present on the upstream context`
