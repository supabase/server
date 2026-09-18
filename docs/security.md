# Security

This document explains the security decisions behind `@supabase/server`. It's informational — you don't need to read this to use the package, but it helps if you want to understand why things work the way they do.

## Timing-safe credential comparison

API keys are compared using constant-time comparison to prevent [timing attacks](https://en.wikipedia.org/wiki/Timing_attack).

A naive string comparison (`===`) short-circuits on the first mismatched character. An attacker can measure response times to guess the key one character at a time. With enough requests, this leaks the full key.

The package uses a **double-HMAC technique**: both strings are HMAC'd with a random ephemeral key, then the resulting digests are compared byte-by-byte with a constant-time XOR loop. This ensures that comparison time is independent of where (or whether) the strings differ.

This applies to:

- **Publishable key verification** (`auth: 'publishable'`) — compares the `apikey` header against stored publishable keys
- **Secret key verification** (`auth: 'secret'`) — compares the `apikey` header against stored secret keys

See `src/core/utils/timing-safe-equal.ts` for the implementation.

## Auth mode security model

Each auth mode provides a different level of trust:

| Mode          | What it verifies                        | Who the caller is        | `supabase` client  | `supabaseAdmin` client |
| ------------- | --------------------------------------- | ------------------------ | ------------------ | ---------------------- |
| `user`        | JWT signature against JWKS              | An authenticated user    | Row-Level Security | Full access            |
| `publishable` | `default` publishable key (timing-safe) | A known client app       | Row-Level Security | Full access            |
| `secret`      | `default` secret key (timing-safe)      | A trusted server/service | Full access        | Full access            |
| `none`        | Nothing — all requests are accepted     | Unknown                  | Row-Level Security | Full access            |

For `publishable` and `secret`, the bare mode matches only the `default` key; use `publishable:<name>` / `secret:<name>` for a specific key or `publishable:*` / `secret:*` to accept any key in the set.

Key implications:

- **`user` mode** verifies the JWT using a local JWKS (JSON Web Key Set). The token must contain a `sub` claim. Verification uses the `jose` library's `jwtVerify` with a local key set — no network calls to an auth server.
- **`publishable` and `secret` modes** compare the `apikey` header against known keys. The comparison is timing-safe. Bare `auth: 'publishable'` / `auth: 'secret'` match only the `default` key; use named keys (`auth: 'secret:automations'`) to accept only that specific key — this follows the principle of least privilege — or the wildcard (`auth: 'secret:*'`) to accept any key in the set.
- **`none` mode** performs zero authentication. The handler runs for every request. The `supabaseAdmin` client is still available, so a compromised `none` endpoint with write operations is a security risk. Only use it for truly public endpoints or when you implement your own auth (e.g., webhook signature verification).

## Named key isolation

Bare `auth: 'secret'` matches only the `default` key. You can restrict an endpoint to a specific named key, or accept any key in the set with the wildcard:

```ts
// Matches only the "default" secret key
withSupabase({ auth: 'secret' }, handler)

// Only accepts the "automations" secret key
withSupabase({ auth: 'secret:automations' }, handler)

// Accepts any secret key in the set
withSupabase({ auth: 'secret:*' }, handler)
```

This limits the blast radius if a key is compromised. An attacker with the `web` publishable key cannot access an endpoint that requires `secret:automations`. Named keys also make it easier to rotate or revoke access for a specific consumer without affecting others.

## JWT verification

JWT verification in `user` mode works as follows:

1. The `Authorization: Bearer <token>` header is extracted from the request
2. The token is verified against the project JWKS. The key set comes from `SUPABASE_JWKS` (inline JSON), else `SUPABASE_JWKS_URL`, else the well-known endpoint derived from `SUPABASE_PUBLIC_URL` or `SUPABASE_URL`; see the resolution order in `docs/environment-variables.md`
3. Verification uses `jose`'s `jwtVerify`. An inline key set needs no network. A URL source is fetched on first use and cached in memory under jose's cooldown and max-age rules; the endpoint must be `https://`, or `http://` on a loopback host
4. If `audience` is configured, the token's `aud` claim must match
5. If `issuer` is configured, the token's `iss` claim must match
6. The token must contain a `sub` (subject) claim to be considered valid
7. On success, the decoded claims are available as `ctx.userClaims` and `ctx.jwtClaims`

If no JWKS source resolves (no inline key set, no URL, and no project URL that passes the transport rule), `user` mode is unavailable and always rejects requests.

**Audience and issuer validation.** Services that share signing keys can accept each other's tokens. The `audience` and `issuer` options close that gap. Each takes a string or an array of accepted values. When an option is set, two rules apply. A token without the claim is rejected. A token with the claim passes only when its value is in the accepted list; for an `aud` array on the token, one matching entry is enough. Supabase Auth sets `aud` to `authenticated` and `iss` to `https://<project-ref>.supabase.co/auth/v1`, so `issuer: fromSupabaseUrl(SUPABASE_URL)` pins an endpoint to one project: `withSupabase({ auth: 'user', issuer: fromSupabaseUrl(SUPABASE_URL) })` or `withRequiredClaims({ issuer: fromSupabaseUrl(SUPABASE_URL) })`. `audience` matters for tokens from a custom issuer that sets its own `aud`. Both are optional. A failed check rejects with `InvalidJwtError` (`INVALID_JWT`).

**No silent downgrade.** When `user` is combined with other modes (e.g. `auth: ['user', 'publishable']`), a JWT that is present but fails verification rejects the request with `InvalidJwtError` (`INVALID_JWT`) — it does not fall through to the next mode. This prevents a bad token paired with a valid `apikey` (or with `'none'`) from being silently downgraded to a less-privileged auth mode. Requests that simply omit the `Authorization` header still fall through as expected.

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
- `apikey: <value>` → used by `publishable` and `secret` modes

Extraction is a separate step from verification (`extractCredentials` vs `verifyCredentials`). This separation means you can inspect raw credentials in custom flows without triggering validation.
