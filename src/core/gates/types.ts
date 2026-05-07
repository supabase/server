/**
 * Type primitives for the gate composition system.
 *
 * @packageDocumentation
 */

/**
 * Sentinel type used in a gate's wrapper signature to surface a key collision
 * with the upstream context as a TypeScript error at the gate's call site.
 *
 * The literal string is part of the type so it appears in the error message
 * (TypeScript prints "Type '…' is not assignable to type 'gate-conflict: …'").
 */
export type Conflict<Key extends string> =
  `gate-conflict: key '${Key}' is already present on the upstream context`
