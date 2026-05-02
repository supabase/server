/**
 * Gate composition primitives.
 *
 * - {@link defineGate} — author-facing helper for declaring a gate.
 *
 * Gates compose by direct nesting: each `withFoo(config, handler)` is a
 * fetch-handler wrapper that runs its check, contributes a flat key to the
 * context, and either short-circuits or invokes the inner handler. Nest them
 * the same way `withSupabase` nests around a handler.
 *
 * @packageDocumentation
 */

export { defineGate } from './define-gate.js'
export type { GateFactory } from './define-gate.js'
export type { Conflict, GateResult } from './types.js'
