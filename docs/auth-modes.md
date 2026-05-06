# Auth Modes

## Overview

Every request is validated against one or more auth modes before your handler runs. The `auth` config determines which modes are accepted.

> **`allow` is deprecated.** The `auth` option replaces the legacy `allow` option. `allow` still works (with a one-time `console.warn`) but will be removed in a future major release. Migration is a find-and-replace: `allow:` → `auth:`.

> **Breaking — auth API renamed.** `'always'` is now `'none'` and `'public'` is now `'publishable'` (including the colon variants `'public:<name>'` → `'publishable:<name>'`). The field on `AuthResult` and `SupabaseContext` was also renamed from `authType` to `authMode` so it matches the `AuthMode` type. The old names no longer work — update the option values you pass in **and** any runtime checks on `ctx.authType` (now `ctx.authMode`).

| Mode            | Credential required                          | Typical use case                       |
| --------------- | -------------------------------------------- | -------------------------------------- |
| `'user'`        | Valid JWT in `Authorization: Bearer <token>` | Authenticated user endpoints           |
| `'publishable'` | Valid publishable key in `apikey` header     | Client-facing, key-validated endpoints |
| `'secret'`      | Valid secret key in `apikey` header          | Server-to-server, internal calls       |
| `'none'`        | None                                         | Open endpoints, custom auth wrappers   |

> **Supabase Edge Functions:** By default, the platform requires a valid JWT on every request same as `'user'`.
> If your function uses `'publishable'`, `'secret'` or `'none'`, disable the platform-level JWT check in `supabase/config.toml`:
>
> ```toml
> [functions.my-function]
> verify_jwt = false
> ```

## User mode

The default. Verifies the JWT using your project's JWKS (JSON Web Key Set).

```ts
import { withSupabase } from '@supabase/server'

export default {
  fetch: withSupabase({ auth: 'user' }, async (_req, ctx) => {
    // ctx.userClaims has the caller's identity
    console.log(ctx.userClaims!.id) // "d0f1a2b3-..."
    console.log(ctx.userClaims!.email) // "user@example.com"
    console.log(ctx.userClaims!.role) // "authenticated"

    // ctx.claims has the raw JWT payload
    console.log(ctx.claims!.sub) // same as userClaims.id
    console.log(ctx.claims!.exp) // token expiration (epoch seconds)

    // ctx.supabase is scoped to this user — RLS applies
    const { data } = await ctx.supabase.from('todos').select()
    return Response.json(data)
  }),
}
```

The caller must send:

```
Authorization: Bearer eyJhbGciOiJIUzI1NiIs...
```

**`userClaims` vs `supabase.auth.getUser()`:** `userClaims` is extracted from the JWT and is available instantly — no network call. It includes `id`, `email`, `role`, `appMetadata`, and `userMetadata`. For the full Supabase `User` object (email confirmation status, providers, linked identities), call `ctx.supabase.auth.getUser()`, which makes a request to the auth server.

## Publishable mode

Validates that the `apikey` header contains a recognized publishable key. Uses timing-safe comparison to prevent timing attacks. See [`security.md`](security.md) for details.

```ts
import { withSupabase } from '@supabase/server'

export default {
  fetch: withSupabase({ auth: 'publishable' }, async (_req, ctx) => {
    // ctx.userClaims is null — no JWT involved
    // ctx.supabase is initialized as anonymous (RLS anon role)
    const { data } = await ctx.supabase.from('products').select()
    return Response.json(data)
  }),
}
```

The caller must send:

```
apikey: sb_publishable_abc123...
```

By default, `publishable` mode validates against the `"default"` key in `SUPABASE_PUBLISHABLE_KEYS`. Use named key syntax to target a specific key (see below).

## Secret mode

Validates that the `apikey` header contains a recognized secret key. Same timing-safe comparison as publishable mode. See [`security.md`](security.md) for details.

```ts
import { withSupabase } from '@supabase/server'

export default {
  fetch: withSupabase({ auth: 'secret' }, async (_req, ctx) => {
    // ctx.supabaseAdmin bypasses RLS — use for privileged operations
    const { data } = await ctx.supabaseAdmin.from('config').select()
    return Response.json(data)
  }),
}
```

The caller must send:

```
apikey: sb_secret_xyz789...
```

## None mode

No credentials required. Every request is accepted.

```ts
import { withSupabase } from '@supabase/server'

export default {
  fetch: withSupabase({ auth: 'none' }, async (_req, ctx) => {
    // ctx.authMode is 'none'
    // ctx.userClaims is null
    // ctx.supabase is anonymous (RLS anon role)
    return Response.json({ status: 'healthy' })
  }),
}
```

Use `none` for health checks, public APIs, or when you handle auth yourself inside the handler.

## Array syntax (multiple modes)

Accept multiple auth methods. Modes are tried in order — the first match wins.

```ts
import { withSupabase } from '@supabase/server'

export default {
  fetch: withSupabase({ auth: ['user', 'secret'] }, async (req, ctx) => {
    // ctx.authMode tells you which mode matched
    if (ctx.authMode === 'user') {
      // Called by an authenticated user
      const { data } = await ctx.supabase.from('reports').select()
      return Response.json(data)
    }

    // Called by another service with a secret key
    const { user_id } = await req.json()
    const { data } = await ctx.supabaseAdmin
      .from('reports')
      .select()
      .eq('user_id', user_id)
    return Response.json(data)
  }),
}
```

A request with a valid JWT matches `'user'`. A request with a valid secret key matches `'secret'`. A request with neither is rejected.

**Fallthrough vs rejection.** A mode is only "tried" when its credential is actually present. A request with no `Authorization` header moves on to the next mode. But if a JWT _is_ present and fails verification (malformed, expired, wrong signature, or missing a `sub` claim), the request is rejected immediately with `InvalidCredentialsError` — it will not silently fall through to `'publishable'`, `'secret'`, or `'none'`. The same rule applies on the API-key side: `'publishable'` and `'secret'` fall through only when no `apikey` header is sent. This prevents a bad credential from being downgraded to a less-privileged auth mode.

## Named key syntax

When your project has multiple API keys (e.g., separate keys for web, mobile, and internal services), use the colon syntax to validate against a specific named key.

Keys are stored as a JSON object in `SUPABASE_PUBLISHABLE_KEYS` or `SUPABASE_SECRET_KEYS`:

```json
{
  "default": "sb_publishable_123...",
  "web": "sb_publishable_abc...",
  "mobile": "sb_publishable_a1b2..."
}
```

### Target a specific key

```ts
// Only accept the "web" publishable key
withSupabase({ auth: 'publishable:web' }, handler)

// Only accept the "internal" secret key
withSupabase({ auth: 'secret:internal' }, handler)
```

### Wildcard — accept any key in the set

```ts
// Accept any publishable key
withSupabase({ auth: 'publishable:*' }, handler)

// Accept any secret key
withSupabase({ auth: 'secret:*' }, handler)
```

### Which key matched?

When using named keys, `ctx.authMode` tells you the mode and `keyName` on the `AuthResult` (from core primitives) tells you which key matched. In the high-level `withSupabase` wrapper, the matched key is used internally for client creation.

### Combining named keys with other modes

```ts
withSupabase({ auth: ['user', 'publishable:web'] }, async (_req, ctx) => {
  // Accepts either a valid JWT or the "web" publishable key
  return Response.json({ authMode: ctx.authMode })
})
```

## How auth flows through the system

1. `extractCredentials(request)` reads `Authorization: Bearer <token>` and `apikey` from headers
2. Each mode in `auth` is tried in order against the extracted credentials
3. First match wins — returns an `AuthResult` with `authMode`, `token`, `userClaims`, `claims`, and `keyName`. A mode falls through to the next only when its credential is absent; a credential that is present but invalid terminates the chain with `InvalidCredentialsError`.
4. The auth result is used to create scoped clients (`supabase` with the user's token, `supabaseAdmin` with the secret key)
5. Everything is bundled into a `SupabaseContext` and passed to your handler
