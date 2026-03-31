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

### Server-to-server (secret key auth)

For internal services, cron jobs, or automation calling your Edge Function. The caller sends the secret key in the `apikey` header. See `docs/auth-modes.md` for named key syntax.

**Edge Function (Deno):**

```ts
import { withSupabase } from 'npm:@supabase/server'

// Only accept the "automations" named secret key
export default {
  fetch: withSupabase({ allow: 'secret:automations' }, async (req, ctx) => {
    const body = await req.json()
    const { data } = await ctx.supabaseAdmin
      .from('scheduled_tasks')
      .insert({ name: body.taskName, scheduled_at: body.scheduledAt })
    return Response.json({ success: true, data })
  }),
}
```

**Caller (external service):**

```ts
await fetch('https://<project>.supabase.co/functions/v1/my-function', {
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
    apikey: 'sb_secret_automations_...', // the named secret key
  },
  body: JSON.stringify({
    taskName: 'cleanup',
    scheduledAt: new Date().toISOString(),
  }),
})
```

Use `allow: 'secret'` to accept any secret key, or `allow: 'secret:name'` to require a specific named key.

### Webhooks (signature verification)

For receiving webhooks from external services (Stripe, GitHub, etc.). Uses `allow: 'always'` because the webhook authenticates via HMAC signature, not Supabase auth. See `docs/webhooks.md`.

**Edge Function (Deno):**

```ts
import { withSupabase } from 'npm:@supabase/server'
import { verifyWebhookSignature } from 'npm:@supabase/server/wrappers'

const WEBHOOK_SECRET = Deno.env.get('WEBHOOK_SECRET')!

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
    await ctx.supabaseAdmin
      .from('webhook_events')
      .insert({ type: event.type, payload: event })

    return Response.json({ received: true })
  }),
}
```

## When to use `allow: 'always'`

> **`allow: 'always'` disables all authentication.** The handler runs for every request with no credential checks. Only use it when auth is genuinely unnecessary (health checks, public status pages) or when the handler implements its own verification (webhook signatures).

**Before using `allow: 'always'`, confirm with the user which case applies:**

1. **The endpoint is truly public** — no sensitive data, no side effects (e.g., a health check). `allow: 'always'` is correct.
2. **Another service calls this function** — use `allow: 'secret'` or `allow: 'secret:<name>'` instead. The caller sends the secret key in the `apikey` header.
3. **A webhook provider calls this function** — use `allow: 'always'` with `verifyWebhookSignature` inside the handler. The provider signs the payload with a shared secret.

**Never use `allow: 'always'` for endpoints that read or write user data without verifying who the caller is.**

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
