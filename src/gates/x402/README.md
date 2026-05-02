# withPayment

> **Experimental:** Stripe's machine-payment crypto deposit mode is a preview API. Both Stripe's surface and this gate may change.

Stripe-facilitated [x402](https://www.x402.org) paywall gate. Charge per-call in USDC for any fetch handler — Stripe issues the deposit address, settles on-chain, and the gate admits the request once the `PaymentIntent` has succeeded.

Persistence (deposit-address → PaymentIntent-id mapping) lives in Supabase Postgres via two RPCs the user installs once. Stripe explicitly assumes the server holds this mapping; there's no `paymentIntents.retrieveByDepositAddress` to fall back on.

```ts
import Stripe from 'stripe'
import { createClient } from '@supabase/supabase-js'
import { withPayment } from '@supabase/server/gates/x402'

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY!, {
  apiVersion: '2026-03-04.preview' as never,
})
const supabaseAdmin = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_SECRET_KEY!,
)

export default {
  fetch: withPayment(
    { stripe, amountCents: 1, client: supabaseAdmin },
    async (req, ctx) => Response.json({ ok: true, paid: ctx.payment.intentId }),
  ),
}
```

## One-time migration

Copy this into `supabase/migrations/<timestamp>_supabase_server_x402.sql` and run `supabase db push`:

```sql
create table if not exists public._supabase_server_x402_intents (
  deposit_address    text primary key,
  payment_intent_id  text not null,
  created_at         timestamptz not null default now()
);

create or replace function public._supabase_server_x402_register(
  p_deposit_address   text,
  p_payment_intent_id text
)
returns void
language sql
as $$
  insert into public._supabase_server_x402_intents
    (deposit_address, payment_intent_id)
  values (p_deposit_address, p_payment_intent_id)
  on conflict (deposit_address) do nothing;
$$;

create or replace function public._supabase_server_x402_lookup(
  p_deposit_address text
)
returns text
language sql
as $$
  select payment_intent_id
  from public._supabase_server_x402_intents
  where deposit_address = p_deposit_address;
$$;

-- Service role only.
alter table public._supabase_server_x402_intents enable row level security;
```

Override the function names via `registerRpc` / `lookupRpc` in the config if you'd rather pick your own.

## How it works

1. **First request — no `X-PAYMENT` header.** `withPayment` creates a Stripe `PaymentIntent` in crypto-deposit mode, records the deposit address → PI id via `registerRpc`, and short-circuits with a `402 Payment Required` carrying an [x402 v1](https://www.x402.org) `accepts` body that advertises the address.
2. **Client pays.** An x402-aware client (or agent) sends USDC to the advertised address on the requested network.
3. **Retry with `X-PAYMENT` header.** The header is a base64-encoded JSON envelope of the form `{ payload: { authorization: { to: <depositAddress> } } }`. `withPayment` decodes it, looks up the matching `PaymentIntent` via `lookupRpc`, and:
   - if `status === "succeeded"`, contributes `{ intentId }` to `ctx.payment` and runs the handler,
   - if not yet settled, replies `402` with `{ error: "payment_not_settled", status }`,
   - if the address is unknown or the header is malformed, falls back to issuing a fresh `402`.

## Config

| Field         | Type                | Description                                            |
| ------------- | ------------------- | ------------------------------------------------------ |
| `stripe`      | `StripeLike`        | Stripe client (or any structurally compatible object). |
| `amountCents` | `number`            | Price per call in USD cents. Stripe converts to USDC.  |
| `network`     | `Network?`          | `'base' \| 'tempo' \| 'solana'`. Default `'base'`.     |
| `client`      | `SupabaseRpcClient` | Supabase admin client.                                 |
| `registerRpc` | `string?`           | Default: `_supabase_server_x402_register`.             |
| `lookupRpc`   | `string?`           | Default: `_supabase_server_x402_lookup`.               |

`StripeLike` is structurally typed — this package does not depend on the `stripe` SDK at runtime or types-level. Pass any object exposing `paymentIntents.create` and `paymentIntents.retrieve`.

## Composing with `withSupabase`

```ts
import type { SupabaseContext } from '@supabase/server'
import { withSupabase } from '@supabase/server'

withSupabase(
  { allow: 'user' },
  withPayment<SupabaseContext>(
    { stripe, amountCents: 5, client: supabaseAdmin },
    async (req, ctx) => {
      // ctx.supabase is the user-scoped client (from withSupabase)
      // ctx.payment.intentId is the settled PaymentIntent id
      const { data } = await ctx.supabase.from('premium_reports').select()
      return Response.json({ data, paid: ctx.payment.intentId })
    },
  ),
)
```

For fully anonymous machine-to-machine paywalls, drop `withSupabase`.

## See also

- [Gate composition primitives](../../core/gates/README.md)
- [x402 specification](https://www.x402.org)
- [Stripe machine payments docs](https://docs.stripe.com/payments/machine/x402)
