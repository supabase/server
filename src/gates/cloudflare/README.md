# Cloudflare gates

Gates that integrate with Cloudflare-issued credentials, headers, and APIs. Compose with [`chain`](../../core/gates/README.md) from `@supabase/server/core/gates`.

```ts
import { chain } from '@supabase/server/core/gates'
import { withTurnstile } from '@supabase/server/gates/cloudflare'

export default {
  fetch: chain(
    withTurnstile({
      secretKey: process.env.TURNSTILE_SECRET_KEY!,
      expectedAction: 'login',
    }),
  )(async (req, ctx) => {
    return Response.json({ ok: true, hostname: ctx.state.turnstile.hostname })
  }),
}
```

## Available gates

| Gate            | Namespace   | Purpose                                                                         |
| --------------- | ----------- | ------------------------------------------------------------------------------- |
| `withTurnstile` | `turnstile` | Verifies a Cloudflare Turnstile bot-check token against `siteverify`.           |
| `withAccess`    | `access`    | Validates a Cloudflare Zero Trust JWT (`Cf-Access-Jwt-Assertion`) against JWKS. |

More gates (geofencing, bot management) are planned — see the package roadmap.

## `withTurnstile`

Verifies the `cf-turnstile-response` token a client widget produces against Cloudflare's siteverify endpoint. On success, contributes the verified challenge metadata to `ctx.state.turnstile`. On failure, short-circuits with a 401 (or 503 if siteverify is unreachable).

### Config

```ts
withTurnstile({
  secretKey, // Turnstile secret key (required)
  expectedAction, // optional: reject if `action` doesn't match
  getToken, // optional: custom token extractor (default: cf-turnstile-response header)
  siteverifyUrl, // optional: override the verify endpoint (useful for tests)
})
```

### Contribution

```ts
ctx.state.turnstile = {
  challengeTs: string  // ISO 8601 timestamp the challenge was solved
  hostname: string     // hostname of the page the widget rendered on
  action: string       // the widget's action label
  cdata: string | null // any cdata the client attached
}
```

### Token location

Turnstile tokens are typically returned to the client by the widget and submitted alongside the form / API call. The default extractor reads the `cf-turnstile-response` request header. For form-encoded or JSON bodies, supply `getToken`:

```ts
withTurnstile({
  secretKey,
  getToken: async (req) => {
    const form = await req.clone().formData()
    return (form.get('cf-turnstile-response') as string | null) ?? null
  },
})
```

`req.clone()` preserves the body for downstream handlers — without it, the body is consumed by the gate.

### Action binding

If you bind your widget's client-side `action` to a value (e.g. `"login"`) and pass `expectedAction: 'login'`, the gate rejects when the verified action doesn't match. This prevents a token issued for one form from being replayed against a different endpoint.

### Errors

| Status | `error`                              | Meaning                                                                         |
| ------ | ------------------------------------ | ------------------------------------------------------------------------------- |
| 401    | `turnstile_token_missing`            | No token was found by `getToken`.                                               |
| 401    | `turnstile_verification_failed`      | Cloudflare reported `success: false`. Body includes `codes` from `error-codes`. |
| 401    | `turnstile_action_mismatch`          | `expectedAction` was set and the verified action differs.                       |
| 503    | `turnstile_verification_unavailable` | Siteverify returned a non-2xx status. Treat as transient.                       |

### Forwarded IP

If `cf-connecting-ip` is present on the request, it's forwarded to siteverify as `remoteip` — recommended by Cloudflare to harden the check against token replay from other IPs. No-op if you're not behind Cloudflare or the header isn't set.

## `withAccess`

Validates the `Cf-Access-Jwt-Assertion` header that Cloudflare attaches to every request to an Access-protected origin. Verifies the signature against your team's JWKS and checks that the `aud` claim matches your application's audience tag. On success, contributes the verified identity at `ctx.state.access`.

### Config

```ts
withAccess({
  teamDomain: 'acme.cloudflareaccess.com', // your team domain
  audience: process.env.CF_ACCESS_AUD!, // your application's AUD tag
})
```

### Contribution

```ts
ctx.state.access = {
  email: string | null
  sub: string                  // Cloudflare's stable identity id
  identityNonce: string | null
  audience: string             // the AUD that was validated
  claims: JWTPayload           // full payload for custom claims
}
```

### Errors

| Status | `error`                | Meaning                                               |
| ------ | ---------------------- | ----------------------------------------------------- |
| 401    | `access_token_missing` | The `Cf-Access-Jwt-Assertion` header was not present. |
| 401    | `access_token_invalid` | Signature, audience, or expiration check failed.      |

### When to use it

For backend services behind a Cloudflare tunnel + Access policy. Cloudflare authenticates the user at the edge and signs every request with a JWT — `withAccess` is the verifier on the origin side. No need to roll your own SSO flow.

## See also

- [Gate composition primitives](../../core/gates/README.md) — `chain`, `defineGate`, ctx shape
- [Turnstile docs](https://developers.cloudflare.com/turnstile/get-started/server-side-validation/)
- [Access JWT validation](https://developers.cloudflare.com/cloudflare-one/identity/authorization-cookie/validating-json/)
