/**
 * Cloudflare gates.
 *
 * Each gate slots into {@link chain} from `@supabase/server/core/gates` and
 * contributes typed state to `ctx.state[namespace]`.
 *
 * @packageDocumentation
 */

export { withAccess } from './with-access.js'
export type { AccessState, WithAccessConfig } from './with-access.js'
export { withTurnstile } from './with-turnstile.js'
export type { TurnstileState, WithTurnstileConfig } from './with-turnstile.js'
