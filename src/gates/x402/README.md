# withPayment

> **Experimental:** Stripe's machine-payment crypto deposit mode is a preview API. Both Stripe's surface and this gate may change.

Stripe-facilitated [x402](https://www.x402.org) paywall gate. Charge per-call in USDC for any fetch handler — Stripe issues the deposit address, settles on-chain, and the chain admits the request once the `PaymentIntent` has succeeded.

Lives under `@supabase/server/gates/x402`. Compose with [`chain`](../../core/gates/README.md) from `@supabase/server/core/gates`.

```ts
import Stripe from 'stripe'
import { chain } from '@supabase/server/core/gates'
import { withPayment } from '@supabase/server/gates/x402'

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY!, {
  apiVersion: '2026-03-04.preview' as never,
})

export default {
  fetch: chain(withPayment({ stripe, amountCents: 1 }))(async (req, ctx) => {
    return Response.json({ ok: true, paid: ctx.state.payment.intentId })
  }),
}
```

## How it works

1. **First request — no `X-PAYMENT` header.** `withPayment` creates a Stripe `PaymentIntent` in crypto-deposit mode, records the deposit address → PI mapping in the store, and short-circuits the chain with a `402 Payment Required` carrying an [x402 v1](https://www.x402.org) `accepts` body that advertises the address.
2. **Client pays.** An x402-aware client (or agent) sends USDC to the advertised address on the requested network.
3. **Retry with `X-PAYMENT` header.** The header is a base64-encoded JSON envelope of the form `{ payload: { authorization: { to: <depositAddress> } } }`. `withPayment` decodes it, looks up the matching `PaymentIntent`, and:
   - if `status === "succeeded"`, contributes `{ intentId }` to `ctx.state.payment` and lets the chain proceed,
   - if not yet settled, replies `402` with `{ error: "payment_not_settled", status }`,
   - if the address is unknown or the header is malformed, falls back to issuing a fresh `402`.

## Config

```ts
withPayment({
  stripe, // a Stripe client (or any structurally compatible object)
  amountCents: 1, // price per call in USD cents; Stripe converts to USDC
  network: 'base', // 'base' | 'tempo' | 'solana' — default 'base'
  store, // deposit-address → PI-id lookup (default: in-memory Map)
})
```

`StripeLike` is structurally typed — this package does not depend on the `stripe` SDK at runtime or types-level. Pass any object exposing `paymentIntents.create` and `paymentIntents.retrieve`.

## Production deployments need a real store

The default store is an in-memory `Map`. That is fine for tests and a single long-lived process, but it loses the deposit-address → PI mapping across restarts and cannot be shared between instances — meaning a paid client may hit a different worker on retry and be asked to pay again.

Provide a Postgres-, Redis-, or KV-backed `PaymentStore`:

```ts
import { chain } from '@supabase/server/core/gates'
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
  fetch: chain(withPayment({ stripe, amountCents: 1, store }))(handler),
}
```

## Composing with `withSupabase`

`withPayment` is a gate; `withSupabase` is the fetch-handler wrapper that establishes Supabase context. Compose by running the chain inside `withSupabase`:

```ts
import { withSupabase } from '@supabase/server'
import { chain } from '@supabase/server/core/gates'
import { withPayment } from '@supabase/server/gates/x402'

export default {
  fetch: withSupabase(
    { allow: 'user' },
    chain(withPayment({ stripe, amountCents: 5 }))(async (req, ctx) => {
      // ctx.supabase is the user-scoped client (from withSupabase)
      // ctx.state.payment.intentId is the settled PaymentIntent id
      const { data } = await ctx.supabase.from('premium_reports').select()
      return Response.json({ data, paid: ctx.state.payment.intentId })
    }),
  ),
}
```

For fully anonymous machine-to-machine paywalls, drop `withSupabase`:

```ts
export default {
  fetch: chain(withPayment({ stripe, amountCents: 1 }))(async (req, ctx) => {
    return Response.json({ paid: ctx.state.payment.intentId })
  }),
}
```

## Migrating from `withPayment(config, handler)`

Earlier versions exposed `withPayment` as a fetch-handler wrapper (`withPayment(config, handler)`). It is now a gate. Wrap your handler with `chain`:

```diff
- export default {
-   fetch: withPayment(
-     { stripe, amountCents: 1 },
-     async (_req, { paymentIntentId }) => {
-       return Response.json({ paid: paymentIntentId })
-     },
-   ),
- }
+ import { chain } from '@supabase/server/core/gates'
+
+ export default {
+   fetch: chain(withPayment({ stripe, amountCents: 1 }))(async (req, ctx) => {
+     return Response.json({ paid: ctx.state.payment.intentId })
+   }),
+ }
```

`PaymentReceipt` is replaced by `PaymentState` (same shape: `{ intentId: string }`, accessible at `ctx.state.payment`).

## API

| Export                      | Description                                                                                    |
| --------------------------- | ---------------------------------------------------------------------------------------------- |
| `withPayment(config)`       | Returns a gate that contributes `{ intentId }` to `ctx.state.payment` once the PI has settled. |
| `PaymentState`              | Shape contributed at `ctx.state.payment`: `{ intentId: string }`                               |
| `PaymentStore`              | Interface for the deposit-address → PaymentIntent-id mapping                                   |
| `WithPaymentConfig`         | Config object accepted by `withPayment`                                                        |
| `Network`                   | `'base' \| 'tempo' \| 'solana'`                                                                |
| `StripeLike`                | Minimal structural type for the Stripe client                                                  |
| `PaymentIntent`             | Subset of Stripe's `PaymentIntent` used by this wrapper                                        |
| `PaymentIntentCreateParams` | Params shape passed to `stripe.paymentIntents.create`                                          |

## See also

- [Gate composition primitives](../../core/gates/README.md) — `chain`, `defineGate`, ctx shape
- [x402 specification](https://www.x402.org)
- [Stripe machine payments docs](https://docs.stripe.com/payments/machine/x402)
