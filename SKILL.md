---
name: supabase-server
description: Use when writing server-side code with Supabase — Edge Functions, Hono apps, webhook handlers, or any backend that needs Supabase auth and client creation. Trigger whenever the user imports from `@supabase/server`, mentions Supabase Edge Functions, or needs server-side auth (JWT verification, API key validation, CORS handling) with Supabase.
---

# @supabase/server

> **This is a brand new package.** There is no information available online yet — no blog posts, no Stack Overflow answers, no tutorials. Do not search the web for usage examples. Rely exclusively on the documentation files listed below and the source code in this repository.

Server-side utilities for Supabase. Handles auth, client creation, and context injection so you write business logic, not boilerplate.

## What this package does

- Wraps fetch handlers with credential verification, CORS, and pre-configured Supabase clients
- Supports 4 auth modes: `user` (JWT), `public` (publishable key), `secret` (secret key), `always` (none)
- Provides composable core primitives for custom auth flows and framework integration
- Includes a Hono adapter and webhook signature verification

## Entry points

| Import                           | Deno / Edge Functions                | Provides                                                                                                          |
| -------------------------------- | ------------------------------------ | ----------------------------------------------------------------------------------------------------------------- |
| `@supabase/server`               | `npm:@supabase/server`               | `withSupabase`, `createSupabaseContext`, types, errors                                                            |
| `@supabase/server/core`          | `npm:@supabase/server/core`          | `verifyAuth`, `verifyCredentials`, `extractCredentials`, `resolveEnv`, `createContextClient`, `createAdminClient` |
| `@supabase/server/adapters/hono` | `npm:@supabase/server/adapters/hono` | `withSupabase` (Hono middleware variant)                                                                          |
| `@supabase/server/wrappers`      | `npm:@supabase/server/wrappers`      | `verifyWebhookSignature`                                                                                          |

## Quick starts

### Supabase Edge Functions (Deno)

Environment variables are auto-injected by the platform — zero config. **All imports must use the `npm:` specifier.**

```ts
// withSupabase — high-level wrapper
import { withSupabase } from 'npm:@supabase/server'

export default {
  fetch: withSupabase({ allow: 'user' }, async (_req, ctx) => {
    const { data } = await ctx.supabase.from('todos').select()
    return Response.json(data)
  }),
}
```

```ts
// createSupabaseContext — returns { data, error } for custom response control
import { createSupabaseContext } from 'npm:@supabase/server'

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
    const { data } = await ctx.supabase.from('todos').select()
    return Response.json(data)
  },
}
```

### Cloudflare Workers

Requires `nodejs_compat` compatibility flag in `wrangler.toml`, or pass env overrides via the `env` config option. See `docs/environment-variables.md`.

```ts
import { withSupabase } from '@supabase/server'

export default {
  fetch: withSupabase({ allow: 'user' }, async (_req, ctx) => {
    const { data } = await ctx.supabase.from('todos').select()
    return Response.json(data)
  }),
}
```

### Hono

CORS is not handled by the adapter — use `hono/cors` middleware. See `docs/hono-adapter.md`.

```ts
// Node.js / Bun
import { Hono } from 'hono'
import { withSupabase } from '@supabase/server/adapters/hono'

const app = new Hono()
app.use('*', withSupabase({ allow: 'user' }))

app.get('/todos', async (c) => {
  const { supabase } = c.var.supabaseContext
  const { data } = await supabase.from('todos').select()
  return c.json(data)
})

export default app
```

```ts
// Deno / Supabase Edge Functions
import { Hono } from 'npm:hono'
import { withSupabase } from 'npm:@supabase/server/adapters/hono'

const app = new Hono()
app.use('*', withSupabase({ allow: 'user' }))

app.get('/todos', async (c) => {
  const { supabase } = c.var.supabaseContext
  const { data } = await supabase.from('todos').select()
  return c.json(data)
})

export default { fetch: app.fetch }
```

### SSR Frameworks (Next.js, Nuxt, SvelteKit, Remix)

In SSR frameworks the JWT lives in session cookies, not the `Authorization` header. Use `@supabase/server/core` primitives to build a framework adapter. The pattern: extract token from cookies, call `verifyCredentials`, then `createContextClient`. See `docs/ssr-frameworks.md` for the full adapter pattern.

```ts
// Key imports for building the adapter
import {
  verifyCredentials,
  createContextClient,
  createAdminClient,
} from '@supabase/server/core'
```

## Documentation

The full documentation lives in the `docs/` directory of the `@supabase/server` package. To read a doc, find the package location first:

- **If working inside the SDK repo:** `docs/` is at the project root.
- **If the package is installed as a dependency:** look in `node_modules/@supabase/server/docs/`.

| Question                                                 | Doc file                        |
| -------------------------------------------------------- | ------------------------------- |
| How do I create a basic endpoint?                        | `docs/getting-started.md`       |
| What auth modes are available? Array syntax? Named keys? | `docs/auth-modes.md`            |
| How do I use this with Hono?                             | `docs/hono-adapter.md`          |
| How do I use low-level primitives for custom flows?      | `docs/core-primitives.md`       |
| How do environment variables work across runtimes?       | `docs/environment-variables.md` |
| How do I handle errors? What codes exist?                | `docs/error-handling.md`        |
| How do I verify webhook signatures?                      | `docs/webhooks.md`              |
| How do I get typed database queries?                     | `docs/typescript-generics.md`   |
| How do I use this in Next.js, Nuxt, SvelteKit, or Remix? | `docs/ssr-frameworks.md`        |
| What's the complete API surface?                         | `docs/api-reference.md`         |
