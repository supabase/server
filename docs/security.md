# Security

This document explains the security decisions behind `@supabase/server`. It's informational — you don't need to read this to use the package, but it helps if you want to understand why things work the way they do.

## Timing-safe credential comparison

API keys are compared using constant-time comparison to prevent [timing attacks](https://en.wikipedia.org/wiki/Timing_attack).

A naive string comparison (`===`) short-circuits on the first mismatched character. An attacker can measure response times to guess the key one character at a time. With enough requests, this leaks the full key.

The package uses a **double-HMAC technique**: both strings are HMAC'd with a random ephemeral key, then the resulting digests are compared byte-by-byte with a constant-time XOR loop. This ensures that comparison time is independent of where (or whether) the strings differ.

This applies to:

- **Publishable key verification** (`allow: 'public'`) — compares the `apikey` header against stored publishable keys
- **Secret key verification** (`allow: 'secret'`) — compares the `apikey` header against stored secret keys

See `src/core/utils/timing-safe-equal.ts` for the implementation.

## Auth mode security model

Each auth mode provides a different level of trust:

| Mode     | What it verifies                    | Who the caller is        | `supabase` client  | `supabaseAdmin` client |
| -------- | ----------------------------------- | ------------------------ | ------------------ | ---------------------- |
| `user`   | JWT signature against JWKS          | An authenticated user    | Row-Level Security | Full access            |
| `public` | Publishable API key (timing-safe)   | A known client app       | Row-Level Security | Full access            |
| `secret` | Secret API key (timing-safe)        | A trusted server/service | Full access        | Full access            |
| `always` | Nothing — all requests are accepted | Unknown                  | Row-Level Security | Full access            |

Key implications:

- **`user` mode** verifies the JWT using a local JWKS (JSON Web Key Set). The token must contain a `sub` claim. Verification uses the `jose` library's `jwtVerify` with a local key set — no network calls to an auth server.
- **`public` and `secret` modes** compare the `apikey` header against known keys. The comparison is timing-safe. If you use named keys (`allow: 'secret:automations'`), only that specific key is accepted — this follows the principle of least privilege.
- **`always` mode** performs zero authentication. The handler runs for every request. The `supabaseAdmin` client is still available, so a compromised `always` endpoint with write operations is a security risk. Only use it for truly public endpoints or when you implement your own auth (e.g., webhook signature verification).

## Named key isolation

Instead of accepting any valid API key, you can restrict an endpoint to a specific named key:

```ts
// Accepts any secret key
withSupabase({ allow: 'secret' }, handler)

// Only accepts the "automations" secret key
withSupabase({ allow: 'secret:automations' }, handler)
```

This limits the blast radius if a key is compromised. An attacker with the `web` publishable key cannot access an endpoint that requires `secret:automations`. Named keys also make it easier to rotate or revoke access for a specific consumer without affecting others.

## JWT verification

JWT verification in `user` mode works as follows:

1. The `Authorization: Bearer <token>` header is extracted from the request
2. The token is verified against the JWKS from the `SUPABASE_JWKS` environment variable
3. Verification uses `jose`'s `jwtVerify` with a **local** key set — there are no network calls to a JWKS endpoint
4. If `SUPABASE_JWT_AUDIENCE` is set, the token's `aud` claim must match
5. If `SUPABASE_JWT_ISSUER` is set, the token's `iss` claim must match
6. The token must contain a `sub` (subject) claim to be considered valid
7. On success, the decoded claims are available as `ctx.userClaims` and `ctx.claims`

If JWKS is not configured (`SUPABASE_JWKS` is missing or malformed), `user` mode is unavailable and will always reject requests.

**Audience and issuer validation.** In setups where multiple services share the same signing keys, a JWT minted by one service could be accepted by another. Setting `SUPABASE_JWT_AUDIENCE` and `SUPABASE_JWT_ISSUER` prevents this by rejecting tokens that weren't issued for your specific service. Both are optional for backward compatibility but recommended in multi-service deployments.

**No silent downgrade.** When `user` is combined with other modes (e.g. `allow: ['user', 'public']`), a JWT that is present but fails verification rejects the request with `InvalidCredentialsError` — it does not fall through to the next mode. This prevents a bad token paired with a valid `apikey` (or with `'always'`) from being silently downgraded to a less-privileged auth mode. Requests that simply omit the `Authorization` header still fall through as expected.

## CORS handling

`withSupabase` handles CORS automatically:

- **Preflight requests** (`OPTIONS`) return `204` with CORS headers and skip the handler entirely — no auth check runs
- **All other requests** get CORS headers appended to the response
- **Error responses** (auth failures) also include CORS headers, so the browser can read the error

CORS defaults come from `@supabase/supabase-js/cors`. You can pass custom headers or disable CORS entirely with `cors: false`.

The Hono adapter does **not** handle CORS — use Hono's built-in `cors` middleware instead.

## Credential extraction

Credentials are extracted from two standard headers:

- `Authorization: Bearer <token>` → used by `user` mode
- `apikey: <value>` → used by `public` and `secret` modes

Extraction is a separate step from verification (`extractCredentials` vs `verifyCredentials`). This separation means you can inspect raw credentials in custom flows without triggering validation.
