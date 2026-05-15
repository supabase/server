/**
 * Cloudflare gates.
 *
 * Each gate is a fetch-handler wrapper — compose by direct nesting — and
 * contributes typed state under its own key on `ctx`.
 *
 * @packageDocumentation
 */

export { withAccess } from './with-access.js'
export type { AccessState, WithAccessConfig } from './with-access.js'
export { withTurnstile } from './with-turnstile.js'
export type { TurnstileState, WithTurnstileConfig } from './with-turnstile.js'
