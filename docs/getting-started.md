# Getting Started

## Installation

```bash
# npm
npm install @supabase/server

# pnpm
pnpm add @supabase/server

# Deno (import directly)
import { withSupabase } from 'npm:@supabase/server'
```

`@supabase/server` requires `@supabase/supabase-js` as a peer dependency:

```bash
# npm
npm install @supabase/supabase-js

# pnpm
pnpm add @supabase/supabase-js
```

## Your first authenticated endpoint

The fastest way to get a working Edge Function with auth:

```ts
import { withSupabase } from '@supabase/server'

export default {
  fetch: withSupabase({ allow: 'user' }, async (_req, ctx) => {
    const { data } = await ctx.supabase.from('todos').select()
    return Response.json(data)
  }),
}
```

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
  fetch: withSupabase({ allow: 'always' }, async (_req, _ctx) => {
    return Response.json({ status: 'ok', time: new Date().toISOString() })
  }),
}
```

## What's in the context

Every handler receives a `SupabaseContext` with these fields:

| Field           | Type                 | Description                                                                                            |
| --------------- | -------------------- | ------------------------------------------------------------------------------------------------------ |
| `supabase`      | `SupabaseClient`     | Client scoped to the caller. RLS policies apply.                                                       |
| `supabaseAdmin` | `SupabaseClient`     | Admin client. Bypasses RLS.                                                                            |
| `userClaims`    | `UserClaims \| null` | JWT-derived identity (`id`, `email`, `role`, `appMetadata`, `userMetadata`). `null` for non-user auth. |
| `claims`        | `JWTClaims \| null`  | Raw JWT payload (snake_case). `null` for non-user auth.                                                |
| `authType`      | `Allow`              | Which auth mode matched: `'user'`, `'public'`, `'secret'`, or `'always'`.                              |

The `supabase` client respects Row-Level Security. When `authType` is `'user'`, the client is scoped to that user's permissions. For other auth modes, it's initialized as anonymous.

The `supabaseAdmin` client always bypasses RLS. Use it for operations that need full database access regardless of who's calling.

`userClaims` gives you a lightweight view of the user's identity from the JWT. For the full Supabase `User` object (email confirmation, providers, etc.), call `ctx.supabase.auth.getUser()`.

## Using createSupabaseContext directly

When you need the context without the full wrapper — inside a framework route handler, custom middleware, or any situation where you want to control the response yourself:

```ts
import { createSupabaseContext } from '@supabase/server'

export default {
  fetch: async (req: Request) => {
    const { data: ctx, error } = await createSupabaseContext(req, {
      allow: 'user',
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
    allow: 'user',
    cors: {
      'Access-Control-Allow-Origin': 'https://myapp.com',
      'Access-Control-Allow-Headers': 'authorization, content-type',
    },
  },
  handler,
)

// Disable CORS (e.g., when a framework handles it)
withSupabase({ allow: 'user', cors: false }, handler)
```

## Deploying to Supabase Edge Functions

On Supabase Edge Functions, environment variables (`SUPABASE_URL`, `SUPABASE_PUBLISHABLE_KEYS`, `SUPABASE_SECRET_KEYS`, `SUPABASE_JWKS`) are automatically available. No configuration needed — your function works out of the box.

For other runtimes (Node.js, Bun, Cloudflare Workers), see [environment-variables.md](environment-variables.md).
