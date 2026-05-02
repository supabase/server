/**
 * Gate composition primitives.
 *
 * - {@link defineGate} — author-facing helper for declaring a gate.
 * - {@link chain} — consumer-facing composer that turns a tuple of gates
 *   into a fetch-handler-shaped function.
 *
 * @packageDocumentation
 */

export { chain } from './chain.js'
export { defineGate } from './define-gate.js'
export type {
  AccumulatedState,
  ChainCtx,
  Gate,
  GateResult,
  MergeStrict,
  ReservedNamespace,
  ValidNamespace,
} from './types.js'
