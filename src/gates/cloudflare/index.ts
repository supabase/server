/**
 * Cloudflare gates.
 *
 * Each gate is a fetch-handler wrapper — compose by direct nesting — and
 * contributes a typed value under its own key on `ctx`.
 *
 * @packageDocumentation
 */

export { withAccess } from './with-access.js'
export type { AccessContribution, WithAccessConfig } from './with-access.js'
export { withTurnstile } from './with-turnstile.js'
export type {
  TurnstileContribution,
  WithTurnstileConfig,
} from './with-turnstile.js'
