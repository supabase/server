# Getting Started

## Installation

```bash
# Deno (import directly)
import { withSupabase } from 'npm:@supabase/server'

# npm
npm install @supabase/server

# pnpm
pnpm add @supabase/server

```

`@supabase/server` requires `@supabase/supabase-js` as a peer dependency:

```bash
# npm
npm install @supabase/supabase-js

# pnpm
pnpm add @supabase/supabase-js
```

## Your first authenticated endpoint

The fastest way to get a working authenticated endpoint:

```ts
import { withSupabase } from '@supabase/server'

export default {
  fetch: withSupabase({ auth: 'user' }, async (_req, ctx) => {
    const { data } = await ctx.supabase.from('todos').select()
    return Response.json(data)
  }),
}
```

> The `export default { fetch }` pattern is the standard module worker interface supported by Deno (including Supabase Edge Functions), Bun, and Cloudflare Workers. For Node.js, use the [Hono adapter](hono-adapter.md) or [core primitives](core-primitives.md) with your framework of choice.

This single wrapper does four things for every request:

1. **CORS** — handles `OPTIONS` preflight and adds CORS headers to all responses
2. **Auth** — extracts and verifies credentials from request headers
3. **Clients** — creates two Supabase clients: one scoped to the caller, one admin
4. **Errors** — returns a JSON error response (`{ message, code }`) if auth fails

Your handler only runs when auth succeeds.

## A public endpoint (no auth)

```ts
import { withSupabase } from '@supabase/server'

export default {
  fetch: withSupabase({ auth: 'none' }, async (_req, _ctx) => {
    return Response.json({ status: 'ok', time: new Date().toISOString() })
  }),
}
```

> **Supabase Edge Functions:** By default, the platform requires a valid JWT on every request. If your function uses `auth: 'publishable'`, `auth: 'secret'`, or `auth: 'none'`, disable the platform-level JWT check in `supabase/config.toml`:
>
> ```toml
> [functions.my-function]
> verify_jwt = false
> ```

## What's in the context

Every handler receives a `SupabaseContext` with these fields:

| Field           | Type                 | Description                                                                                            |
| --------------- | -------------------- | ------------------------------------------------------------------------------------------------------ |
| `supabase`      | `SupabaseClient`     | Client scoped to the caller. RLS policies apply.                                                       |
| `supabaseAdmin` | `SupabaseClient`     | Admin client. Bypasses RLS.                                                                            |
| `userClaims`    | `UserClaims \| null` | JWT-derived identity (`id`, `email`, `role`, `appMetadata`, `userMetadata`). `null` for non-user auth. |
| `claims`        | `JWTClaims \| null`  | Raw JWT payload (snake_case). `null` for non-user auth.                                                |
| `authMode`      | `AuthMode`           | Which auth mode matched: `'user'`, `'publishable'`, `'secret'`, or `'none'`.                           |
| `authKeyName`   | `string \| null`     | Which auth key name of the API key that was used.                                                      |

The `supabase` client respects Row-Level Security. When `authMode` is `'user'`, the client is scoped to that user's permissions. For other auth modes, it's initialized as anonymous.

The `supabaseAdmin` client always bypasses RLS. Use it for operations that need full database access regardless of who's calling.

`userClaims` gives you a lightweight view of the user's identity from the JWT. For the full Supabase `User` object (email confirmation, providers, etc.), call `ctx.supabase.auth.getUser()`.

## Using createSupabaseContext directly

When you need the context without the full wrapper — inside a framework route handler, custom middleware, or any situation where you want to control the response yourself:

```ts
import { createSupabaseContext } from '@supabase/server'

export default {
  fetch: async (req: Request) => {
    const { data: ctx, error } = await createSupabaseContext(req, {
      auth: 'user',
    })

    if (error) {
      return Response.json(
        { message: error.message, code: error.code },
        { status: error.status },
      )
    }

    const { data } = await ctx!.supabase.from('todos').select()
    return Response.json(data)
  },
}
```

`createSupabaseContext` returns a result tuple `{ data, error }` instead of producing a Response. This gives you full control over error formatting and response headers.

## CORS configuration

CORS is enabled by default with standard supabase-js headers. You can customize or disable it:

```ts
// Custom CORS headers
withSupabase(
  {
    auth: 'user',
    cors: {
      'Access-Control-Allow-Origin': 'https://myapp.com',
      'Access-Control-Allow-Headers': 'authorization, content-type',
    },
  },
  handler,
)

// Disable CORS (e.g., when a framework handles it)
withSupabase({ auth: 'user', cors: false }, handler)
```

## Runtimes

`withSupabase` and `createSupabaseContext` work with any runtime that supports the Web API `Request`/`Response` standard. The [core primitives](core-primitives.md) go further — they work in any environment where you can extract headers, regardless of the request/response model (Express, Fastify, etc.).

- **Supabase Edge Functions** — environment variables are automatically injected by the platform. Zero config needed.
- **Deno / Bun** — works out of the box with the module worker pattern.
- **Node.js** — set variables via `.env` files or your hosting platform. Use the [Hono adapter](hono-adapter.md) or [core primitives](core-primitives.md) to integrate with any framework.
- **Cloudflare Workers** — enable `nodejs_compat` or pass env overrides via the `env` config option.

For full details on environment setup per runtime, see [environment-variables.md](environment-variables.md).
