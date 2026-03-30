# Webhooks

## Overview

`verifyWebhookSignature` verifies HMAC-SHA256 webhook signatures with timing-safe comparison, preventing both tampering and timing attacks.

```ts
import { verifyWebhookSignature } from '@supabase/server/wrappers'
```

## Basic usage

```ts
import { verifyWebhookSignature } from '@supabase/server/wrappers'

const payload = '{"event":"user.created","user_id":"123"}'
const signature = 'a1b2c3d4...' // hex-encoded HMAC-SHA256
const secret = 'whsec_my_webhook_secret'

const isValid = await verifyWebhookSignature(payload, signature, secret)
```

The function:

1. Computes HMAC-SHA256 of the payload using the secret
2. Converts the result to a hex string
3. Compares with the provided signature using timing-safe double-HMAC comparison
4. Returns `true` if valid, `false` otherwise

## Complete webhook handler

```ts
import { withSupabase } from '@supabase/server'
import { verifyWebhookSignature } from '@supabase/server/wrappers'

const WEBHOOK_SECRET = process.env.WEBHOOK_SECRET!

export default {
  fetch: withSupabase({ allow: 'always' }, async (req, ctx) => {
    const payload = await req.text()
    const signature = req.headers.get('x-webhook-signature') ?? ''

    const isValid = await verifyWebhookSignature(
      payload,
      signature,
      WEBHOOK_SECRET,
    )

    if (!isValid) {
      return Response.json({ error: 'Invalid signature' }, { status: 401 })
    }

    const event = JSON.parse(payload)

    // Process the webhook using the admin client
    await ctx.supabaseAdmin
      .from('webhook_events')
      .insert({ type: event.type, payload: event })

    return Response.json({ received: true })
  }),
}
```

The function uses `allow: 'always'` because webhooks authenticate via their signature, not via Supabase auth modes. The `supabaseAdmin` client is used to write to the database since there's no user context.

## Standalone webhook handler (without withSupabase)

If you don't need Supabase clients:

```ts
import { verifyWebhookSignature } from '@supabase/server/wrappers'

const WEBHOOK_SECRET = process.env.WEBHOOK_SECRET!

export default {
  fetch: async (req: Request) => {
    const payload = await req.text()
    const signature = req.headers.get('x-webhook-signature') ?? ''

    const isValid = await verifyWebhookSignature(
      payload,
      signature,
      WEBHOOK_SECRET,
    )

    if (!isValid) {
      return Response.json({ error: 'Invalid signature' }, { status: 401 })
    }

    const event = JSON.parse(payload)
    // Process event...

    return Response.json({ received: true })
  },
}
```

## Security notes

- **Timing-safe comparison:** The verification uses a double-HMAC technique — both the expected and provided signatures are HMAC'd with a random ephemeral key, then compared bitwise. This prevents an attacker from learning the correct signature byte-by-byte through timing differences.
- **Always verify before parsing:** Read the raw body as text, verify the signature, then parse. Parsing before verification could expose you to attacks via malformed payloads.
- **Signature format:** The function expects hex-encoded signatures. If your webhook provider uses base64, convert before passing to `verifyWebhookSignature`.
