/**
 * Stripe-facilitated x402 paywall gate.
 *
 * Issues an HTTP 402 with a Stripe-generated USDC deposit address on
 * unauthenticated requests, and lets the handler run once the corresponding
 * PaymentIntent has settled on-chain.
 *
 * Persistence (deposit-address → PaymentIntent-id mapping) lives in Supabase
 * Postgres via two RPCs the user installs once. See this gate's README for
 * the migration.
 *
 * @see https://docs.stripe.com/payments/machine/x402
 * @see https://www.x402.org
 */

import { defineGate } from '../../core/gates/index.js'

const DEFAULT_REGISTER_RPC = '_supabase_server_x402_register'
const DEFAULT_LOOKUP_RPC = '_supabase_server_x402_lookup'

/** Networks supported by Stripe's machine-payment crypto deposit mode. */
export type Network = 'base' | 'tempo' | 'solana'

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

/**
 * Structural subset of the Supabase admin client surface used by this gate.
 * Typed as `PromiseLike` so `supabase-js`'s `PostgrestFilterBuilder` (a
 * thenable, not a strict `Promise`) satisfies it.
 */
export interface SupabaseRpcClient {
  rpc<T = unknown>(
    fn: string,
    args?: Record<string, unknown>,
  ): PromiseLike<{
    data: T | null
    error: { message: string; code?: string } | null
  }>
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
   * RPC that registers a deposit address against a PaymentIntent id. Called
   * with `{ p_deposit_address: text, p_payment_intent_id: text }`.
   *
   * @defaultValue `'_supabase_server_x402_register'`
   */
  registerRpc?: string

  /**
   * RPC that looks up a PaymentIntent id by deposit address. Called with
   * `{ p_deposit_address: text }` and must return the PaymentIntent id
   * (or `null` if unknown).
   *
   * @defaultValue `'_supabase_server_x402_lookup'`
   */
  lookupRpc?: string
}

/**
 * Shape contributed at `ctx.payment` once the gate has admitted a paid request.
 */
export interface PaymentState {
  /** The id of the settled Stripe `PaymentIntent` that paid for this call. */
  intentId: string
}

/**
 * x402 paywall gate. Must be wrapped by `withSupabase` (or any wrapper that
 * provides `supabaseAdmin`) — the gate calls into it for the deposit-address
 * → PaymentIntent-id mapping.
 *
 * @example
 * ```ts
 * import Stripe from 'stripe'
 * import { withSupabase } from '@supabase/server'
 * import { withPayment } from '@supabase/server/gates/x402'
 *
 * const stripe = new Stripe(env.STRIPE_SECRET_KEY, {
 *   apiVersion: '2026-03-04.preview' as never,
 * })
 *
 * export default {
 *   fetch: withSupabase(
 *     { allow: 'always' },
 *     withPayment(
 *       { stripe, amountCents: 1 },
 *       async (req, ctx) =>
 *         Response.json({ ok: true, paid: ctx.payment.intentId }),
 *     ),
 *   ),
 * }
 * ```
 */
export const withPayment = defineGate<
  'payment',
  WithPaymentConfig,
  { supabaseAdmin: SupabaseRpcClient },
  PaymentState
>({
  key: 'payment',
  run: (config) => {
    const network = config.network ?? 'base'
    const registerRpc = config.registerRpc ?? DEFAULT_REGISTER_RPC
    const lookupRpc = config.lookupRpc ?? DEFAULT_LOOKUP_RPC

    return async (req, ctx) => {
      const header = req.headers.get('x-payment')
      if (header) {
        const toAddress = decodePaymentHeader(header)
        if (toAddress) {
          const paymentIntentId = await lookupPaymentIntent(
            ctx.supabaseAdmin,
            lookupRpc,
            toAddress,
          )
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
        response: await issuePaymentRequired(
          req,
          ctx.supabaseAdmin,
          config,
          network,
          registerRpc,
        ),
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

async function lookupPaymentIntent(
  client: SupabaseRpcClient,
  rpc: string,
  depositAddress: string,
): Promise<string | null> {
  const { data, error } = await client.rpc<string | null>(rpc, {
    p_deposit_address: depositAddress,
  })
  if (error) {
    if (
      error.code === '42883' ||
      error.message.toLowerCase().includes('function')
    ) {
      throw new Error(
        `withPayment: lookup RPC '${rpc}' not found. Install the migration ` +
          `from this gate's README before calling.`,
      )
    }
    throw new Error(`withPayment: lookup rpc failed: ${error.message}`)
  }
  return typeof data === 'string' && data.length > 0 ? data : null
}

async function registerPaymentIntent(
  client: SupabaseRpcClient,
  rpc: string,
  depositAddress: string,
  paymentIntentId: string,
): Promise<void> {
  const { error } = await client.rpc(rpc, {
    p_deposit_address: depositAddress,
    p_payment_intent_id: paymentIntentId,
  })
  if (error) {
    if (
      error.code === '42883' ||
      error.message.toLowerCase().includes('function')
    ) {
      throw new Error(
        `withPayment: register RPC '${rpc}' not found. Install the migration ` +
          `from this gate's README before calling.`,
      )
    }
    throw new Error(`withPayment: register rpc failed: ${error.message}`)
  }
}

async function issuePaymentRequired(
  req: Request,
  client: SupabaseRpcClient,
  config: WithPaymentConfig,
  network: Network,
  registerRpc: string,
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
  await registerPaymentIntent(client, registerRpc, address, pi.id)

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
