# @supabase/server/x402

> **Experimental:** Stripe's machine-payment crypto deposit mode is a preview API. Both Stripe's surface and this wrapper may change.

Stripe-facilitated [x402](https://www.x402.org) paywall middleware. Charge per-call in USDC for any fetch handler — Stripe issues the deposit address, settles on-chain, and your handler only runs once the `PaymentIntent` has succeeded.

```ts
import Stripe from 'stripe'
import { withPayment } from '@supabase/server/x402'

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY!, {
  apiVersion: '2026-03-04.preview' as never,
})

export default {
  fetch: withPayment(
    { stripe, amountCents: 1 },
    async (_req, { paymentIntentId }) => {
      return Response.json({ ok: true, paid: paymentIntentId })
    },
  ),
}
```

## How it works

1. **First request — no `X-PAYMENT` header.** `withPayment` creates a Stripe `PaymentIntent` in crypto-deposit mode, records the deposit address → PI mapping in the store, and replies `402 Payment Required` with an [x402 v1](https://www.x402.org) `accepts` body advertising the address.
2. **Client pays.** An x402-aware client (or agent) sends USDC to the advertised address on the requested network.
3. **Retry with `X-PAYMENT` header.** The header is a base64-encoded JSON envelope of the form `{ payload: { authorization: { to: <depositAddress> } } }`. `withPayment` decodes it, looks up the matching `PaymentIntent`, and:
   - if `status === "succeeded"`, runs your handler with `{ paymentIntentId }`,
   - if not yet settled, replies `402` with `{ error: "payment_not_settled", status }`,
   - if the address is unknown or the header is malformed, falls back to issuing a fresh `402`.

## Config

```ts
withPayment(
  {
    stripe, // a Stripe client (or any structurally compatible object)
    amountCents: 1, // price per call in USD cents; Stripe converts to USDC
    network: 'base', // 'base' | 'tempo' | 'solana' — default 'base'
    store, // deposit-address → PI-id lookup (default: in-memory Map)
  },
  handler,
)
```

`StripeLike` is structurally typed — this package does not depend on the `stripe` SDK at runtime or types-level. Pass any object exposing `paymentIntents.create` and `paymentIntents.retrieve`.

## Production deployments need a real store

The default store is an in-memory `Map`. That is fine for tests and a single long-lived process, but it loses the deposit-address → PI mapping across restarts and cannot be shared between instances — meaning a paid client may hit a different worker on retry and be asked to pay again.

Provide a Postgres-, Redis-, or KV-backed `PaymentStore`:

```ts
import { withPayment, type PaymentStore } from '@supabase/server/x402'

const store: PaymentStore = {
  async set(depositAddress, paymentIntentId) {
    await kv.set(`x402:${depositAddress}`, paymentIntentId, { ex: 3600 })
  },
  async get(depositAddress) {
    return kv.get(`x402:${depositAddress}`)
  },
}

export default {
  fetch: withPayment({ stripe, amountCents: 1, store }, handler),
}
```

## Composing with `withSupabase`

`withPayment` and `withSupabase` are both fetch-handler wrappers, so they nest. Wrap the auth layer on the inside to gate authenticated routes behind a paywall, or use `withPayment` stand-alone for fully anonymous machine-to-machine endpoints.

```ts
import { withSupabase } from '@supabase/server'
import { withPayment } from '@supabase/server/x402'

export default {
  fetch: withPayment(
    { stripe, amountCents: 5 },
    withSupabase({ allow: 'user' }, async (_req, ctx) => {
      const { data } = await ctx.supabase.from('premium_reports').select()
      return Response.json(data)
    }),
  ),
}
```

## API

| Export                      | Description                                                  |
| --------------------------- | ------------------------------------------------------------ |
| `withPayment(config, fn)`   | Wraps a handler with an x402 paywall                         |
| `PaymentStore`              | Interface for the deposit-address → PaymentIntent-id mapping |
| `PaymentReceipt`            | Second arg passed to the handler: `{ paymentIntentId }`      |
| `WithPaymentConfig`         | Config object accepted by `withPayment`                      |
| `Network`                   | `'base' \| 'tempo' \| 'solana'`                              |
| `StripeLike`                | Minimal structural type for the Stripe client                |
| `PaymentIntent`             | Subset of Stripe's `PaymentIntent` used by this wrapper      |
| `PaymentIntentCreateParams` | Params shape passed to `stripe.paymentIntents.create`        |

## See also

- [x402 specification](https://www.x402.org)
- [Stripe machine payments docs](https://docs.stripe.com/payments/machine/x402)
