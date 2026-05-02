# `@supabase/server/gates/webhook`

HMAC signature verification for inbound webhooks. Reads the raw request body, verifies it against a shared secret, checks the replay window, and contributes the parsed event + raw bytes to `ctx.webhook`.

```ts
import { withWebhook } from '@supabase/server/gates/webhook'

export default {
  fetch: withWebhook(
    {
      provider: {
        kind: 'stripe',
        secret: process.env.STRIPE_WEBHOOK_SECRET!,
      },
    },
    async (req, ctx) => {
      const event = ctx.webhook.event as { type: string }
      if (event.type === 'payment_intent.succeeded') {
        // …
      }
      return new Response(null, { status: 204 })
    },
  ),
}
```

## Built-in providers

### Stripe

Verifies the `Stripe-Signature` header (`t=<ts>,v1=<sig>`), rejects on:

- missing header (`signature_missing`)
- malformed header (`signature_malformed`)
- timestamp outside `toleranceMs` (`signature_expired`, default 5 minutes)
- HMAC mismatch (`signature_invalid`)

Supports key rotation: pass `secret: ['whsec_new', 'whsec_old']` and the gate accepts any of them.

```ts
withWebhook({
  provider: {
    kind: 'stripe',
    secret: process.env.STRIPE_WEBHOOK_SECRET!,
    toleranceMs: 5 * 60 * 1000, // optional, default 5 minutes
  },
})
```

### Custom

For any other provider (Svix/Resend, GitHub, Slack, Shopify, in-house) supply a `verify` function. The gate calls it with the raw body already consumed:

```ts
withWebhook({
  provider: {
    kind: 'custom',
    async verify(req, rawBody) {
      const signature = req.headers.get('x-hub-signature-256') ?? ''
      const expected =
        'sha256=' + (await hmacHex(process.env.GH_WEBHOOK_SECRET!, rawBody))
      if (!timingSafeEqual(signature, expected)) {
        return { ok: false, error: 'signature_invalid' }
      }
      const event = JSON.parse(rawBody)
      return {
        ok: true,
        event,
        deliveryId: req.headers.get('x-github-delivery') ?? '',
        timestamp: Date.now(),
      }
    },
  },
})
```

## Contribution

```ts
ctx.webhook = {
  event: unknown      // parsed JSON body
  rawBody: string     // raw bytes the signature was computed over
  deliveryId: string  // provider-supplied id (Stripe: event.id; GitHub: x-github-delivery)
  timestamp: number   // ms epoch
}
```

`rawBody` is preserved so downstream handlers can re-verify, forward to other systems, or pass to libraries that expect raw bytes.

## Body consumption

The gate reads the request body via `req.text()` once. Downstream handlers that call `req.json()` would fail because the body is already consumed — read from `ctx.webhook.event` (parsed) or `ctx.webhook.rawBody` (raw) instead.

## Idempotency

The gate doesn't dedupe. Webhooks are typically delivered at-least-once; persist `deliveryId` to a `webhook_events(provider, delivery_id)` table with a unique index and skip duplicates in your handler.

## See also

- [Gate composition primitives](../../core/gates/README.md)
- [Stripe webhook signing docs](https://docs.stripe.com/webhooks#verify-manually)
