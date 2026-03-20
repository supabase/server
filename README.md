# @supabase/<tbd>

[![License](https://img.shields.io/npm/l/nx.svg?style=flat-square)](./LICENSE)
[![Package](https://img.shields.io/npm/v/@supabase/<tbd>)](https://www.npmjs.com/package/@supabase/<tbd>)
[![pkg.pr.new](https://pkg.pr.new/badge/supabase/<tbd>)](https://pkg.pr.new/~/supabase/<tbd>)

Server-side utilities for Supabase. Handles auth, client creation, and context injection so you write business logic, not boilerplate.

```ts
import { withSupabase } from '@supabase/<tbd>'

Deno.serve(
  withSupabase({ allow: 'user' }, async (req, ctx) => {
    const { data } = await ctx.supabase.from('todos').select()
    return Response.json(data)
  }),
)
```

One import. One line of config. Auth is validated, clients are scoped, CORS is handled. Your handler only runs on successful auth.

## Installation

```bash
# Deno
import { withSupabase } from "npm:@supabase/<tbd>";

# npm
pnpm add @supabase/<tbd>
```

## Quick Start

### Authenticated endpoint

```ts
import { withSupabase } from '@supabase/<tbd>'

Deno.serve(
  withSupabase({ allow: 'user' }, async (req, ctx) => {
    // ctx.supabase — RLS-scoped to the authenticated user
    // ctx.supabaseAdmin — bypasses RLS (service role)
    // ctx.user — user identity (id, email, role)
    // ctx.claims — JWT claims
    // ctx.authType — which auth mode matched

    const { data } = await ctx.supabase.from('todos').select()
    return Response.json(data)
  }),
)
```

### Public endpoint (no auth)

```ts
Deno.serve(
  withSupabase({ allow: 'always' }, async (req, ctx) => {
    return Response.json({ status: 'ok' })
  }),
)
```

### API key protected

```ts
Deno.serve(
  withSupabase({ allow: 'secret' }, async (req, ctx) => {
    const { data } = await ctx.supabaseAdmin.from('config').select()
    return Response.json(data)
  }),
)
```

### Dual auth (user or service)

```ts
Deno.serve(
  withSupabase({ allow: ['user', 'secret'] }, async (req, ctx) => {
    const userId = ctx.user?.id ?? (await req.json()).user_id
    const { data } = await ctx.supabaseAdmin
      .from('reports')
      .select()
      .eq('user_id', userId)
    return Response.json(data)
  }),
)
```

## Auth Modes

| Mode               | Credential            | Use case                                            |
| ------------------ | --------------------- | --------------------------------------------------- |
| `"user"` (default) | Valid JWT             | Authenticated user endpoints                        |
| `"public"`         | Valid publishable key | Client-facing, key-validated endpoints              |
| `"secret"`         | Valid secret key      | Server-to-server, internal calls                    |
| `"always"`         | None                  | Open endpoints, wrappers that handle their own auth |

Array syntax (`allow: ["user", "secret"]`) accepts multiple auth methods — first match wins.

Named key validation: `allow: "public:web_app"` validates against a specific named key in `SUPABASE_PUBLISHABLE_KEYS`.

## Context

Every handler receives a `SupabaseContext`:

```ts
interface SupabaseContext {
  supabase: SupabaseClient // RLS-scoped (user or anon depending on auth)
  supabaseAdmin: SupabaseClient // Bypasses RLS
  user: UserIdentity | null // Present when auth is JWT
  claims: JWTClaims | null // Present when auth is JWT
  authType: Allow // Which auth mode matched
}
```

`supabase` is always the safe client — it respects RLS. When `authType` is `"user"`, it's scoped to that user's permissions. Otherwise, it's initialized as anonymous.

`supabaseAdmin` always bypasses RLS. Use it for operations that need full database access.

## Config

```ts
withSupabase(
  {
    allow: 'user', // who can call this function
    cors: { origins: ['https://myapp.com'] }, // CORS config (optional)
    env: { url: '...' }, // env overrides (optional)
  },
  handler,
)
```

`cors` defaults to allowing all origins. Set `cors: false` to disable CORS handling (e.g. when using a framework that handles CORS separately).

`env` overrides environment variable resolution. Defaults to reading `SUPABASE_URL`, `SUPABASE_PUBLISHABLE_KEYS`, `SUPABASE_SECRET_KEYS`, and `SUPABASE_JWKS` from the runtime environment.

## Framework Adapters

### Hono

```ts
import { Hono } from 'hono'
import { withSupabase } from '@supabase/<tbd>/adapters/hono'

const app = new Hono()

app.get('/todos', withSupabase({ allow: 'user' }), async (c) => {
  const { supabase: sb } = c.var.supabaseContext
  const { data } = await sb.from('todos').select()
  return c.json(data)
})

app.get('/health', (c) => c.json({ status: 'ok' }))

Deno.serve(app.fetch)
```

The adapter does not handle CORS — use `hono/cors` for that. Per-route auth works naturally by applying the middleware to specific routes.

## Primitives

For when you need more control than `withSupabase` provides — multiple routes with different auth, custom response headers, or building your own wrapper.

All primitives are available from `@supabase/<tbd>/core`.

```ts
import {
  verifyAuth,
  createContextClient,
  createAdminClient,
} from '@supabase/<tbd>/core'
```

### verifyAuth

Extracts credentials from a Request and validates against the allow config.

```ts
const { data: auth, error } = await verifyAuth(req, { allow: 'user' })
if (error) {
  return Response.json({ error: error.message }, { status: error.status })
}
```

### verifyCredentials

Low-level — works with raw credentials instead of a Request. Used by SSR adapters and custom auth flows.

```ts
const credentials = { token: myToken, apikey: null }
const { data: auth, error } = await verifyCredentials(credentials, {
  allow: 'user',
})
```

### createContextClient / createAdminClient

```ts
const supabase = createContextClient(auth.token) // user-scoped, RLS applies
const supabase = createContextClient() // anonymous, RLS as anon
const supabaseAdmin = createAdminClient() // bypasses RLS
```

### createSupabaseContext

Full context assembly from a Request — `verifyAuth` + client creation in one call.

```ts
const { data: ctx, error } = await createSupabaseContext(req, { allow: 'user' })
```

### resolveEnv

Resolves environment variables with optional overrides.

```ts
const { data: env, error } = resolveEnv({
  url: process.env.NEXT_PUBLIC_SUPABASE_URL,
})
```

### Example: custom multi-route handler

```ts
import { verifyAuth, createContextClient } from '@supabase/<tbd>/core'

Deno.serve(async (req) => {
  const url = new URL(req.url)

  if (url.pathname === '/health') {
    return Response.json({ status: 'ok' })
  }

  if (url.pathname === '/todos') {
    const { data: auth, error } = await verifyAuth(req, { allow: 'user' })
    if (error)
      return Response.json({ error: error.message }, { status: error.status })

    const supabase = createContextClient(auth.token)
    const { data } = await supabase.from('todos').select()
    return Response.json(data)
  }

  return new Response('Not found', { status: 404 })
})
```

## Environment Variables

Automatically available in Supabase Edge Functions:

| Variable                    | Description                           |
| --------------------------- | ------------------------------------- |
| `SUPABASE_URL`              | Your project URL                      |
| `SUPABASE_PUBLISHABLE_KEYS` | Publishable API keys                  |
| `SUPABASE_SECRET_KEYS`      | Secret API keys                       |
| `SUPABASE_JWKS`             | JSON Web Key Set for JWT verification |

For other environments, pass overrides via the `env` config option or `resolveEnv()`.

## Exports

| Export                          | What's in it                                                                                                      |
| ------------------------------- | ----------------------------------------------------------------------------------------------------------------- |
| `@supabase/<tbd>`               | `withSupabase`, `createSupabaseContext`                                                                           |
| `@supabase/<tbd>/core`          | `verifyAuth`, `verifyCredentials`, `extractCredentials`, `createContextClient`, `createAdminClient`, `resolveEnv` |
| `@supabase/<tbd>/wrappers`      | `verifyWebhookSignature`                                                                                          |
| `@supabase/<tbd>/adapters/hono` | `withSupabase` (Hono middleware)                                                                                  |

## Development

```bash
pnpm install
pnpm dev
```

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md) for development workflow, commit conventions, and release process.

## License

MIT
