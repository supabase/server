/**
 * Stripe-facilitated x402 paywall.
 *
 * Compose with {@link withSupabase} to gate authenticated routes; use stand-alone
 * for fully anonymous machine-to-machine paywalls.
 *
 * @packageDocumentation
 */

export { withPayment } from './with-payment.js'
export type {
  Network,
  PaymentIntent,
  PaymentIntentCreateParams,
  PaymentReceipt,
  PaymentStore,
  StripeLike,
  WithPaymentConfig,
} from './with-payment.js'
