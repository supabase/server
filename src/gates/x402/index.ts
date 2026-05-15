/**
 * Stripe-facilitated x402 paywall gate.
 *
 * @packageDocumentation
 */

export { withPayment } from './with-payment.js'
export type {
  Network,
  PaymentIntent,
  PaymentIntentCreateParams,
  PaymentState,
  StripeLike,
  SupabaseRpcClient,
  WithPaymentConfig,
} from './with-payment.js'
