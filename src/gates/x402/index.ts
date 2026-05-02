/**
 * Stripe-facilitated x402 paywall gate.
 *
 * Compose with {@link chain} from `@supabase/server/core/gates`. Optionally
 * wrap with {@link withSupabase} to gate authenticated routes; use stand-alone
 * for fully anonymous machine-to-machine paywalls.
 *
 * @packageDocumentation
 */

export { withPayment } from './with-payment.js'
export type {
  Network,
  PaymentIntent,
  PaymentIntentCreateParams,
  PaymentState,
  PaymentStore,
  StripeLike,
  WithPaymentConfig,
} from './with-payment.js'
