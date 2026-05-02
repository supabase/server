/**
 * Stripe-facilitated x402 paywall gate.
 *
 * Issues an HTTP 402 with a Stripe-generated USDC deposit address on
 * unauthenticated requests, and lets the chain proceed once the corresponding
 * PaymentIntent has settled on-chain.
 *
 * @see https://docs.stripe.com/payments/machine/x402
 * @see https://www.x402.org
 */

import { defineGate } from '../../core/gates/index.js'

/** Networks supported by Stripe's machine-payment crypto deposit mode. */
export type Network = 'base' | 'tempo' | 'solana'

/**
 * Maps a Stripe-issued deposit address back to the PaymentIntent that owns it.
 *
 * Implementations must persist across requests in any deployment that runs more
 * than one instance (i.e. anything other than a single long-lived process).
 * The default in-memory store is suitable only for tests and single-process dev.
 */
export interface PaymentStore {
  set(depositAddress: string, paymentIntentId: string): Promise<void>
  get(depositAddress: string): Promise<string | null>
}

/**
 * Subset of the `Stripe` client surface used by `withPayment`. Structurally
 * typed so callers pass their own `Stripe` instance without this package
 * depending on the `stripe` SDK at the type level.
 */
export interface StripeLike {
  paymentIntents: {
    create(params: PaymentIntentCreateParams): Promise<PaymentIntent>
    retrieve(id: string): Promise<PaymentIntent>
  }
}

export interface PaymentIntent {
  id: string
  status: string
  next_action?: {
    crypto_display_details?: {
      deposit_addresses?: Partial<Record<Network, { address: string }>>
    }
  } | null
}

export interface PaymentIntentCreateParams {
  amount: number
  currency: string
  payment_method_types: ['crypto']
  payment_method_data: { type: 'crypto' }
  payment_method_options: {
    crypto: {
      mode: 'deposit'
      deposit_options: { networks: Network[] }
    }
  }
  confirm: true
}

export interface WithPaymentConfig {
  /** A `Stripe` instance configured with a secret key and the x402 preview API version. */
  stripe: StripeLike

  /** Price per call, denominated in USD cents. Stripe converts to USDC at settlement. */
  amountCents: number

  /** @defaultValue `"base"` */
  network?: Network

  /**
   * Lookup table mapping deposit address → PaymentIntent id. Defaults to an
   * in-memory `Map`. Production deployments should pass a Postgres-, Redis-,
   * or KV-backed implementation so the mapping survives across instances.
   */
  store?: PaymentStore
}

/**
 * Shape contributed to `ctx.state.payment` once the chain has admitted a
 * paid request.
 */
export interface PaymentState {
  /** The id of the settled Stripe `PaymentIntent` that paid for this call. */
  intentId: string
}

/**
 * x402 paywall gate. Compose with {@link chain} (and optionally
 * {@link withSupabase}) to gate a handler behind a Stripe-settled USDC payment.
 *
 * - Without `X-PAYMENT`, rejects with a 402 advertising a freshly-created
 *   Stripe `PaymentIntent`'s deposit address.
 * - With `X-PAYMENT`, decodes the base64 payload, looks up the matching
 *   `PaymentIntent` via `store`, and admits the request iff it has succeeded
 *   — placing `{ intentId }` at `ctx.state.payment`.
 *
 * @example
 * ```ts
 * import Stripe from 'stripe'
 * import { chain } from '@supabase/server/core/gates'
 * import { withPayment } from '@supabase/server/gates/x402'
 *
 * const stripe = new Stripe(env.STRIPE_SECRET_KEY, {
 *   apiVersion: '2026-03-04.preview' as never,
 * })
 *
 * export default {
 *   fetch: chain(withPayment({ stripe, amountCents: 1 }))(async (req, ctx) => {
 *     return Response.json({ ok: true, paid: ctx.state.payment.intentId })
 *   }),
 * }
 * ```
 */
export const withPayment = defineGate<
  'payment',
  WithPaymentConfig,
  Record<never, never>,
  PaymentState
>({
  namespace: 'payment',
  run: (config) => {
    const network = config.network ?? 'base'
    const store = config.store ?? createMemoryStore()

    return async (req) => {
      const header = req.headers.get('x-payment')
      if (header) {
        const toAddress = decodePaymentHeader(header)
        if (toAddress) {
          const paymentIntentId = await store.get(toAddress)
          if (paymentIntentId) {
            const pi =
              await config.stripe.paymentIntents.retrieve(paymentIntentId)
            if (pi.status === 'succeeded') {
              return {
                kind: 'pass',
                contribution: { intentId: paymentIntentId },
              }
            }
            return {
              kind: 'reject',
              response: Response.json(
                {
                  x402Version: 1,
                  error: 'payment_not_settled',
                  status: pi.status,
                },
                { status: 402 },
              ),
            }
          }
        }
      }

      return {
        kind: 'reject',
        response: await issuePaymentRequired(req, config, network, store),
      }
    }
  },
})

function decodePaymentHeader(header: string): string | null {
  try {
    const decoded = JSON.parse(atob(header)) as {
      payload?: { authorization?: { to?: unknown } }
    }
    const to = decoded.payload?.authorization?.to
    return typeof to === 'string' ? to : null
  } catch {
    return null
  }
}

async function issuePaymentRequired(
  req: Request,
  config: WithPaymentConfig,
  network: Network,
  store: PaymentStore,
): Promise<Response> {
  const pi = await config.stripe.paymentIntents.create({
    amount: config.amountCents,
    currency: 'usd',
    payment_method_types: ['crypto'],
    payment_method_data: { type: 'crypto' },
    payment_method_options: {
      crypto: {
        mode: 'deposit',
        deposit_options: { networks: [network] },
      },
    },
    confirm: true,
  })

  const address =
    pi.next_action?.crypto_display_details?.deposit_addresses?.[network]
      ?.address
  if (!address) {
    throw new Error(
      `Stripe PaymentIntent ${pi.id} did not return a deposit address for ${network}`,
    )
  }
  await store.set(address, pi.id)

  return Response.json(
    {
      x402Version: 1,
      accepts: [
        {
          scheme: 'exact',
          network,
          maxAmountRequired: String(config.amountCents),
          asset: 'USDC',
          payTo: address,
          resource: new URL(req.url).pathname,
          extra: { stripePaymentIntent: pi.id },
        },
      ],
    },
    { status: 402 },
  )
}

function createMemoryStore(): PaymentStore {
  const map = new Map<string, string>()
  return {
    async set(addr, id) {
      map.set(addr, id)
    },
    async get(addr) {
      return map.get(addr) ?? null
    },
  }
}
