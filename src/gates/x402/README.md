# withPayment

> **Experimental:** Stripe's machine-payment crypto deposit mode is a preview API. Both Stripe's surface and this gate may change.

Stripe-facilitated [x402](https://www.x402.org) paywall gate. Charge per-call in USDC for any fetch handler — Stripe issues the deposit address, settles on-chain, and the gate admits the request once the `PaymentIntent` has succeeded.

```ts
import Stripe from 'stripe'
import { withPayment } from '@supabase/server/gates/x402'

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY!, {
  apiVersion: '2026-03-04.preview' as never,
})

export default {
  fetch: withPayment({ stripe, amountCents: 1 }, async (req, ctx) => {
    return Response.json({ ok: true, paid: ctx.payment.intentId })
  }),
}
```

## How it works

1. **First request — no `X-PAYMENT` header.** `withPayment` creates a Stripe `PaymentIntent` in crypto-deposit mode, records the deposit address → PI mapping in the store, and short-circuits with a `402 Payment Required` carrying an [x402 v1](https://www.x402.org) `accepts` body that advertises the address.
2. **Client pays.** An x402-aware client (or agent) sends USDC to the advertised address on the requested network.
3. **Retry with `X-PAYMENT` header.** The header is a base64-encoded JSON envelope of the form `{ payload: { authorization: { to: <depositAddress> } } }`. `withPayment` decodes it, looks up the matching `PaymentIntent`, and:
   - if `status === "succeeded"`, contributes `{ intentId }` to `ctx.payment` and runs the handler,
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
import { withPayment, type PaymentStore } from '@supabase/server/gates/x402'

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

Nest `withPayment` inside `withSupabase` to gate authenticated routes. Pass `<SupabaseContext>` to thread the host's keys into the inner handler's `ctx`:

```ts
import type { SupabaseContext } from '@supabase/server'
import { withSupabase } from '@supabase/server'
import { withPayment } from '@supabase/server/gates/x402'

export default {
  fetch: withSupabase(
    { allow: 'user' },
    withPayment<SupabaseContext>(
      { stripe, amountCents: 5 },
      async (req, ctx) => {
        // ctx.supabase is the user-scoped client (from withSupabase)
        // ctx.payment.intentId is the settled PaymentIntent id
        const { data } = await ctx.supabase.from('premium_reports').select()
        return Response.json({ data, paid: ctx.payment.intentId })
      },
    ),
  ),
}
```

For fully anonymous machine-to-machine paywalls, drop `withSupabase`:

```ts
export default {
  fetch: withPayment({ stripe, amountCents: 1 }, async (req, ctx) => {
    return Response.json({ paid: ctx.payment.intentId })
  }),
}
```

## API

| Export                         | Description                                                                                                             |
| ------------------------------ | ----------------------------------------------------------------------------------------------------------------------- |
| `withPayment(config, handler)` | Wraps `handler` so it only runs once the inbound x402 payment has settled; contributes `{ intentId }` to `ctx.payment`. |
| `PaymentState`                 | Shape contributed at `ctx.payment`: `{ intentId: string }`.                                                             |
| `PaymentStore`                 | Interface for the deposit-address → PaymentIntent-id mapping.                                                           |
| `WithPaymentConfig`            | Config object accepted by `withPayment`.                                                                                |
| `Network`                      | `'base' \| 'tempo' \| 'solana'`.                                                                                        |
| `StripeLike`                   | Minimal structural type for the Stripe client.                                                                          |
| `PaymentIntent`                | Subset of Stripe's `PaymentIntent` used by this wrapper.                                                                |
| `PaymentIntentCreateParams`    | Params shape passed to `stripe.paymentIntents.create`.                                                                  |

## See also

- [Gate composition primitives](../../core/gates/README.md) — `defineGate`, ctx shape, prereqs, conflict detection.
- [x402 specification](https://www.x402.org)
- [Stripe machine payments docs](https://docs.stripe.com/payments/machine/x402)
