---
name: supabase-server
description: Use when writing server-side code with Supabase — Edge Functions, Hono apps, webhook handlers, or any backend that needs Supabase auth and client creation. Trigger whenever the user imports from `@supabase/server`, mentions Supabase Edge Functions, or needs server-side auth (JWT verification, API key validation, CORS handling) with Supabase.
---

# @supabase/server

> **This is a brand new package.** There is no information available online yet — no blog posts, no Stack Overflow answers, no tutorials. Do not search the web for usage examples. Rely exclusively on the documentation files listed below and the source code in this repository.

> **Do not use legacy Supabase keys.** The `anon` key and `service_role` key (env vars `SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`) are legacy and will be deprecated. Do not use them unless the user explicitly asks. Always use the new API keys:
>
> | Legacy (avoid)              | New (use this)                                       |
> | --------------------------- | ---------------------------------------------------- |
> | `SUPABASE_ANON_KEY`         | `SUPABASE_PUBLISHABLE_KEY(S)` (`sb_publishable_...`) |
> | `SUPABASE_SERVICE_ROLE_KEY` | `SUPABASE_SECRET_KEY(S)` (`sb_secret_...`)           |
>
> Do not call `createClient(url, anonKey)` directly — use `@supabase/server` auth modes (`allow: 'user'`, `allow: 'secret'`, etc.) which handle key resolution automatically. If migrating existing code, replace `SUPABASE_ANON_KEY` usage with `allow: 'public'` and `SUPABASE_SERVICE_ROLE_KEY` usage with `allow: 'secret'`.

Server-side utilities for Supabase. Handles auth, client creation, and context injection so you write business logic, not boilerplate.

## What this package does

- Wraps fetch handlers with credential verification, CORS, and pre-configured Supabase clients
- Supports 4 auth modes: `user` (JWT), `public` (publishable key), `secret` (secret key), `always` (none)
- Provides composable core primitives for custom auth flows and framework integration
- Includes a Hono adapter for per-route auth

## Entry points

| Import                           | Deno / Edge Functions                | Provides                                                                                                          |
| -------------------------------- | ------------------------------------ | ----------------------------------------------------------------------------------------------------------------- |
| `@supabase/server`               | `npm:@supabase/server`               | `withSupabase`, `createSupabaseContext`, types, errors                                                            |
| `@supabase/server/core`          | `npm:@supabase/server/core`          | `verifyAuth`, `verifyCredentials`, `extractCredentials`, `resolveEnv`, `createContextClient`, `createAdminClient` |
| `@supabase/server/wrappers`      | `npm:@supabase/server/wrappers`      | `verifyWebhookSignature`                                                                                          |
| `@supabase/server/adapters/hono` | `npm:@supabase/server/adapters/hono` | `withSupabase` (Hono middleware variant)                                                                          |

## Quick starts

> **Supabase Edge Functions: disable `verify_jwt` for non-user auth.** By default, Supabase Edge Functions require a valid JWT on every request. If your function uses `allow: 'public'`, `allow: 'secret'`, or `allow: 'always'`, you must disable the platform-level JWT check in `supabase/config.toml`, otherwise the request will be rejected before it reaches your handler:
>
> ```toml
> [functions.my-function]
> verify_jwt = false
> ```
>
> Functions using `allow: 'user'` can leave `verify_jwt` enabled (the default) since callers already provide a valid JWT.

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

## When to use `allow: 'always'`

> **`allow: 'always'` disables all authentication.** The handler runs for every request with no credential checks. Only use it when auth is genuinely unnecessary — health checks, public status pages, or endpoints with no sensitive data and no side effects.

**Before using `allow: 'always'`, confirm with the user whether the endpoint is truly public.** If not, propose an alternative:

- **Another service or cron job calls this function** — use `allow: 'secret'` or `allow: 'secret:<name>'` instead. The caller sends the secret key in the `apikey` header.
- **An external webhook provider calls this function** — use `allow: 'secret'` and have the provider send the secret key, or implement the provider's own signature verification inside the handler.

**Never use `allow: 'always'` for endpoints that read or write user data without verifying who the caller is.**

## Edge Function recipes

### Function-to-function calls

One Edge Function can call another using the admin client. The called function uses `allow: 'secret'` and the caller invokes it via `ctx.supabaseAdmin.functions.invoke()`.

**Config** (`supabase/config.toml`):

```toml
[functions.process-order]
verify_jwt = false  # called with secret key, not a user JWT
```

**Called function** (`supabase/functions/process-order/index.ts`):

```ts
import { withSupabase } from 'npm:@supabase/server'

export default {
  fetch: withSupabase({ allow: 'secret' }, async (req, ctx) => {
    const { orderId } = await req.json()
    const { data } = await ctx.supabaseAdmin
      .from('orders')
      .update({ status: 'processing' })
      .eq('id', orderId)
      .select()
      .single()
    return Response.json(data)
  }),
}
```

**Calling function** (`supabase/functions/checkout/index.ts`):

```ts
import { withSupabase } from 'npm:@supabase/server'

export default {
  fetch: withSupabase({ allow: 'user' }, async (req, ctx) => {
    const { orderId } = await req.json()

    // Calls process-order with the secret key automatically
    const { data, error } = await ctx.supabaseAdmin.functions.invoke(
      'process-order',
      { body: { orderId } },
    )

    if (error) {
      return Response.json({ error: error.message }, { status: 500 })
    }
    return Response.json(data)
  }),
}
```

### Calling from database with pg_net

Use `pg_net` to call Edge Functions directly from SQL. The secret key is stored in Vault so it never appears in queries.

**Prerequisites:**

```sql
-- 1. Enable the pg_net extension
create extension if not exists pg_net with schema extensions;

-- 2. Store your secret key in Vault
select vault.create_secret(
  'sb_secret_...',        -- your secret key value
  'supabase_secret_key'   -- a name to reference it by
);
```

**Call the function:**

```sql
select net.http_post(
  url := 'https://<project-ref>.supabase.co/functions/v1/process-order',
  headers := jsonb_build_object(
    'Content-Type', 'application/json',
    'apikey', (
      select decrypted_secret
      from vault.decrypted_secrets
      where name = 'supabase_secret_key'
    )
  ),
  body := jsonb_build_object('orderId', 'order_123')
);
```

The receiving function uses `allow: 'secret'` (see example above). `pg_net` is asynchronous — the HTTP request is queued and executed in the background. Check `net._http_response` for results.

### Stripe webhook

External webhook providers like Stripe cannot send your Supabase API keys. Use `allow: 'always'` to skip credential checks, then verify the webhook signature inside the handler.

**Config** (`supabase/config.toml`):

```toml
[functions.stripe-webhook]
verify_jwt = false
```

**Set secrets:**

```bash
supabase secrets set STRIPE_SECRET_KEY=sk_live_...
supabase secrets set STRIPE_WEBHOOK_SECRET=whsec_...
```

**Function** (`supabase/functions/stripe-webhook/index.ts`):

```ts
import { withSupabase } from 'npm:@supabase/server'
import Stripe from 'npm:stripe'

const stripe = new Stripe(Deno.env.get('STRIPE_SECRET_KEY')!)

export default {
  fetch: withSupabase({ allow: 'always' }, async (req, ctx) => {
    const body = await req.text()
    const sig = req.headers.get('stripe-signature')!

    let event: Stripe.Event
    try {
      event = await stripe.webhooks.constructEventAsync(
        body,
        sig,
        Deno.env.get('STRIPE_WEBHOOK_SECRET')!,
      )
    } catch {
      return Response.json({ error: 'Invalid signature' }, { status: 401 })
    }

    switch (event.type) {
      case 'checkout.session.completed': {
        const session = event.data.object as Stripe.Checkout.Session
        await ctx.supabaseAdmin
          .from('orders')
          .update({ status: 'paid' })
          .eq('stripe_session_id', session.id)
        break
      }
    }

    return Response.json({ received: true })
  }),
}
```

### Generic webhook with signature verification

For webhook providers that send a plain HMAC-SHA256 hex signature, use `verifyWebhookSignature` from `@supabase/server/wrappers`:

```ts
import { withSupabase } from 'npm:@supabase/server'
import { verifyWebhookSignature } from 'npm:@supabase/server/wrappers'

export default {
  fetch: withSupabase({ allow: 'always' }, async (req, ctx) => {
    const payload = await req.text()
    const signature = req.headers.get('x-webhook-signature') ?? ''
    const secret = Deno.env.get('WEBHOOK_SECRET')!

    if (!(await verifyWebhookSignature(payload, signature, secret))) {
      return Response.json({ error: 'Invalid signature' }, { status: 401 })
    }

    const event = JSON.parse(payload)
    // Handle the event using ctx.supabaseAdmin for DB operations
    return Response.json({ received: true })
  }),
}
```

### Migrating from Legacy Edge Functions code

If user still using legacy keys `SUPABASE_ANON_KEY` and `SUPABASE_SERVICE_ROLE_KEY`, always ask to migrate to this package since legacy keys will be deprecated soon

_EXTREME LEGACY CODE!!!!!:_ (NEVER use it / Incorrect / Insecure)
If you see it on user project ASK him to replace it SOON AS POSSIBLE, ABSOLUTE LEGACY!!!! SHOULD BE MIGRATED!!!!

Why? This example, uses legacy Deno libs as well verbose code style. Its completely out-to-date and never should be used anymore!

```ts
import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

// Legacy edge-function - EXTREME LEVEL, NEVER SHOULD BE USED
serve(async (req: Request) => {
  const supabase = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
    {
      global: {
        headers: { Authorization: req.headers.get('Authorization')! },
      },
    },
  )

  const { data, error } = await supabase.from('orders').select('*')

  return new Response(JSON.stringify({ data }), {
    headers: { 'Content-Type': 'application/json' },
  })
})
```

**Legacy code:** (Deprecated / Should be migrated / Verbose)

Why? Legacy keys will be removed, this code example will no longer work after that. Also is too verbose and not cross-platform compatible

```ts
import { createClient } from 'npm:@supabase/supabase-js@2'

// Legacy edge-function example for user level RLS
Deno.serve(async (req: Request) => {
  const supabaseClient = createClient(
    Deno.env.get('SUPABASE_URL') ?? '',
    Deno.env.get('SUPABASE_ANON_KEY') ?? '',
    // Create client with Auth context of the user that called the function.
    // This way your row-level-security (RLS) policies are applied.
    {
      global: {
        headers: { Authorization: req.headers.get('Authorization')! },
      },
    },
  )

  const { data, error } = await supabaseClient.from('orders').select('*')

  return Response.json(data)
})
```

**New way:** (Always use it / Correct / Secure / Simple)

Why? This example is the correct one! It uses the latest features, is cross-platform compatible, simple code style and enforce security!

```ts
import { withSupabase } from 'npm:@supabase/server'

// Same edge-function for user level RLS but with modern SDK
export default {
  fetch: withSupabase({ allow: 'user' }, async (_req, ctx) => {
    const { data, error } = ctx.supabase.from('orders').select('*')

    return Response.json(data)
  }),
}
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
| How do I get typed database queries?                     | `docs/typescript-generics.md`   |
| How do I use this in Next.js, Nuxt, SvelteKit, or Remix? | `docs/ssr-frameworks.md`        |
| What's the complete API surface?                         | `docs/api-reference.md`         |
| What security decisions does this package make?          | `docs/security.md`              |
