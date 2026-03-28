---
name: supabase-server
description: Use when writing server-side code with Supabase — Edge Functions, Hono apps, webhook handlers, or any backend that needs Supabase auth and client creation. Trigger whenever the user imports from `@supabase/server`, mentions Supabase Edge Functions, or needs server-side auth (JWT verification, API key validation, CORS handling) with Supabase.
---

# @supabase/server

Server-side utilities for Supabase. Handles auth, client creation, and context injection so you write business logic, not boilerplate.

## What this package does

- Wraps fetch handlers with credential verification, CORS, and pre-configured Supabase clients
- Supports 4 auth modes: `user` (JWT), `public` (publishable key), `secret` (secret key), `always` (none)
- Provides composable core primitives for custom auth flows and framework integration
- Includes a Hono adapter and webhook signature verification

## Entry points

| Import                           | Provides                                                                                                          |
| -------------------------------- | ----------------------------------------------------------------------------------------------------------------- |
| `@supabase/server`               | `withSupabase`, `createSupabaseContext`, types, errors                                                            |
| `@supabase/server/core`          | `verifyAuth`, `verifyCredentials`, `extractCredentials`, `resolveEnv`, `createContextClient`, `createAdminClient` |
| `@supabase/server/adapters/hono` | `withSupabase` (Hono middleware variant)                                                                          |
| `@supabase/server/wrappers`      | `verifyWebhookSignature`                                                                                          |

## Quick example

```ts
import { withSupabase } from '@supabase/server'

export default {
  fetch: withSupabase({ allow: 'user' }, async (_req, ctx) => {
    const { data } = await ctx.supabase.from('todos').select()
    return Response.json(data)
  }),
}
```

## Where to look

| Question                                                 | Doc                                                            |
| -------------------------------------------------------- | -------------------------------------------------------------- |
| How do I create a basic Edge Function?                   | [docs/getting-started.md](docs/getting-started.md)             |
| What auth modes are available? Array syntax? Named keys? | [docs/auth-modes.md](docs/auth-modes.md)                       |
| How do I use this with Hono?                             | [docs/hono-adapter.md](docs/hono-adapter.md)                   |
| How do I use low-level primitives for custom flows?      | [docs/core-primitives.md](docs/core-primitives.md)             |
| How do environment variables work across runtimes?       | [docs/environment-variables.md](docs/environment-variables.md) |
| How do I handle errors? What codes exist?                | [docs/error-handling.md](docs/error-handling.md)               |
| How do I verify webhook signatures?                      | [docs/webhooks.md](docs/webhooks.md)                           |
| How do I get typed database queries?                     | [docs/typescript-generics.md](docs/typescript-generics.md)     |
| What's the complete API surface?                         | [docs/api-reference.md](docs/api-reference.md)                 |
