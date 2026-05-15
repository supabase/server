# `@supabase/server/gates/webhook`

HMAC signature verification for inbound webhooks. Reads the raw request body, verifies it against a shared secret, checks the replay window, and contributes the parsed event + raw bytes to `ctx.webhook`.

```ts
import { withWebhook } from '@supabase/server/gates/webhook'

export default {
  fetch: withWebhook(
    {
      provider: {
        kind: 'github',
        secret: process.env.GITHUB_WEBHOOK_SECRET!,
      },
    },
    async (req, ctx) => {
      const event = req.headers.get('x-github-event')
      if (event === 'pull_request') {
        const pr = ctx.webhook.event as { action: string }
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

### GitHub

Verifies the `X-Hub-Signature-256` header (`sha256=<hex>`), rejects on:

- missing header (`signature_missing`)
- missing `sha256=` prefix (`signature_malformed`)
- HMAC mismatch (`signature_invalid`)

GitHub's signing scheme has no timestamp, so there's no replay window — pin events to the `X-GitHub-Delivery` UUID for idempotency (see [Idempotency](#idempotency)). The event type is delivered out-of-band in the `X-GitHub-Event` header; the gate exposes it via `req.headers`.

Key rotation works the same as Stripe: pass `secret: ['new', 'old']` to accept either.

```ts
withWebhook(
  {
    provider: {
      kind: 'github',
      secret: process.env.GITHUB_WEBHOOK_SECRET!,
    },
  },
  async (req, ctx) => {
    switch (req.headers.get('x-github-event')) {
      case 'pull_request': {
        const pr = ctx.webhook.event as { action: string }
        // …
        break
      }
      case 'push': {
        // …
        break
      }
    }
    return new Response(null, { status: 204 })
  },
)
```

### Custom

For any other provider (Svix/Resend, Slack, Shopify, in-house) supply a `verify` function. The gate calls it with the raw body already consumed. Slack, for instance, signs `v0:<timestamp>:<body>` and exposes both pieces in headers:

```ts
withWebhook({
  provider: {
    kind: 'custom',
    async verify(req, rawBody) {
      const ts = req.headers.get('x-slack-request-timestamp') ?? ''
      const sig = req.headers.get('x-slack-signature') ?? ''
      if (Math.abs(Date.now() / 1000 - Number(ts)) > 5 * 60) {
        return { ok: false, error: 'signature_expired' }
      }
      const expected =
        'v0=' +
        (await hmacHex(
          process.env.SLACK_SIGNING_SECRET!,
          `v0:${ts}:${rawBody}`,
        ))
      if (!timingSafeEqual(sig, expected)) {
        return { ok: false, error: 'signature_invalid' }
      }
      return {
        ok: true,
        event: JSON.parse(rawBody),
        deliveryId: req.headers.get('x-slack-request-id') ?? '',
        timestamp: Number(ts) * 1000,
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
