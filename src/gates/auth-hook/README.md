# `@supabase/server/gates/auth-hook`

Gate for [Supabase Auth Hooks](https://supabase.com/docs/guides/auth/auth-hooks). It verifies the hook's [Standard Webhooks](https://www.standardwebhooks.com/) signature and injects the decoded payload at `ctx.authHook` — so your handler is business logic, not signature plumbing.

```ts
import {
  withAuthHook,
  type SendEmailHookPayload,
} from '@supabase/server/gates/auth-hook'

export default {
  fetch: withAuthHook<SendEmailHookPayload>(
    { secret: process.env.SEND_EMAIL_HOOK_SECRET! },
    async (_req, ctx) => {
      const { user, email_data } = ctx.authHook.payload
      // ...send the email with your provider...
      return new Response(null, { status: 200 })
    },
  ),
}
```

A valid request reaches your handler with `ctx.authHook` populated. An invalid or missing signature, or a timestamp outside the replay window, short-circuits with `401` — your handler never runs.

## What it verifies

Supabase signs auth hooks with the Standard Webhooks scheme. The gate:

1. **Normalizes the secret.** The dashboard secret is `v1,whsec_<base64>`; the gate strips the `v1,` version tag and `whsec_` prefix and base64-decodes the rest to the HMAC key. You can pass any of `v1,whsec_<base64>`, `whsec_<base64>`, or the bare `<base64>`.
2. **Requires the headers.** `webhook-id`, `webhook-timestamp`, `webhook-signature`.
3. **Recomputes the signature.** `HMAC-SHA256(key, "<id>.<timestamp>.<rawBody>")`, base64-encoded, compared in constant time.
4. **Blocks replays.** Rejects a `webhook-timestamp` further than `toleranceInSeconds` (default `300`) from now.
5. **Survives rotation.** `webhook-signature` may list several space-delimited signatures; any matching `v1` entry admits.

No `standardwebhooks` dependency — verification uses Web Crypto (`crypto.subtle`), so it runs the same on Deno, Cloudflare Workers, Bun, and Node.

## Config

| Field                | Type       | Description                                                                |
| -------------------- | ---------- | -------------------------------------------------------------------------- |
| `secret`             | `string`   | Hook secret. Accepts `v1,whsec_<base64>`, `whsec_<base64>`, or `<base64>`. |
| `toleranceInSeconds` | `number?`  | Replay window around `webhook-timestamp`. Default `300`.                   |
| `rejectStatus`       | `number?`  | Status on verification failure. Default `401`.                             |
| `rejectBody`         | `unknown?` | Body on verification failure. Default `{ error: 'invalid_signature' }`.    |

## Contribution

`ctx.authHook` is an `AuthHookContribution<Payload>`:

```ts
ctx.authHook.payload // the parsed hook body, typed by the Payload argument
ctx.authHook.webhookId // the verified `webhook-id`
ctx.authHook.timestamp // the verified `webhook-timestamp` (unix seconds)
```

## Typing the payload

`withAuthHook<Payload>` defaults `Payload` to `AuthHookPayload` — a union of the shipped hook shapes. Pass a specific member to narrow `ctx.authHook.payload`:

```ts
import {
  withAuthHook,
  type SendEmailHookPayload,
  type SendSMSHookPayload,
} from '@supabase/server/gates/auth-hook'

withAuthHook<SendEmailHookPayload>(config, async (_req, ctx) => {
  ctx.authHook.payload.email_data.email_action_type // fully typed
  return new Response(null, { status: 200 })
})
```

Shipped payload types: `SendEmailHookPayload`, `SendSMSHookPayload`, `CustomAccessTokenHookPayload`, `MFAVerificationHookPayload`, `PasswordVerificationHookPayload`, plus the shared `AuthHookUser`.

## Returning a response

The response shape is the handler's to decide, per hook — `withAuthHook` only owns the request side. Supabase Auth treats an empty `200` as success. To override behavior (e.g. a Custom Access Token Hook), return the JSON Supabase expects:

```ts
withAuthHook<CustomAccessTokenHookPayload>(config, async (_req, ctx) => {
  const claims = { ...ctx.authHook.payload.claims, custom: true }
  return Response.json({ claims })
})
```

> **If you return a body, make it JSON.** Supabase Auth parses the hook response as JSON to look for an `{ error: { http_code, message } }` result. An empty `200` (`new Response(null, { status: 200 })`) reads as success, and `Response.json(...)` is fine — but a bare string like `new Response('OK')` is `text/plain` and gets rejected with `Invalid JSON response. Received content-type: text/plain`.

## Single namespace caveat

The gate occupies `ctx.authHook` — only one `withAuthHook` per stack.

## See also

- [Gate authoring guide](../README.md)
- [Gate composition primitives](../../core/gates/README.md)
- [Supabase Auth Hooks docs](https://supabase.com/docs/guides/auth/auth-hooks)
