# @supabase/server

[![License](https://img.shields.io/npm/l/nx.svg?style=flat-square)](./LICENSE)
[![Package](https://img.shields.io/npm/v/@supabase/server)](https://www.npmjs.com/package/@supabase/server)
[![pkg.pr.new](https://pkg.pr.new/badge/supabase/server)](https://pkg.pr.new/~/supabase/server)

Server-side utilities for Supabase. Handles auth, client creation, and context injection so you write business logic, not boilerplate.

```ts
import { withSupabase } from '@supabase/server'

export default {
  fetch: withSupabase({ allow: 'user' }, async (_req, ctx) => {
    const { data } = await ctx.supabase.from('todos').select()
    return Response.json(data)
  }),
}
```

One import. One line of config. Auth is validated, clients are scoped, CORS is handled. Your handler only runs on successful auth.

## Installation

```bash
# npm
npm install @supabase/server

# pnpm
pnpm add @supabase/server

# Deno / Supabase Edge Functions (no install — import directly)
import { withSupabase } from "npm:@supabase/server";
```

### AI coding skills

Install the skill so your AI coding agent (Claude Code, Cursor, etc.) knows how to use this package:

```bash
npx skills add supabase/server
```

## Quick Start

### Authenticated endpoint

```ts
export default {
  fetch: withSupabase({ allow: 'user' }, async (_req, ctx) => {
    // ctx.supabase — RLS-scoped to the authenticated user
    // ctx.supabaseAdmin — bypasses RLS (service role)
    // ctx.userClaims — user identity from JWT (id, email, role)
    // ctx.claims — JWT claims
    // ctx.authType — which auth mode matched

    const { data } = await ctx.supabase.from('todos').select()
    return Response.json(data)
  }),
}
```

### Public endpoint (no auth)

```ts
export default {
  fetch: withSupabase({ allow: 'always' }, async (_req, _ctx) => {
    return Response.json({ status: 'ok' })
  }),
}
```

### API key protected

```ts
export default {
  fetch: withSupabase({ allow: 'secret' }, async (_req, ctx) => {
    const { data } = await ctx.supabaseAdmin.from('config').select()
    return Response.json(data)
  }),
}
```

### Dual auth (user or service)

```ts
export default {
  fetch: withSupabase({ allow: ['user', 'secret'] }, async (req, ctx) => {
    const userId = ctx.userClaims?.id ?? (await req.json()).user_id
    const { data } = await ctx.supabaseAdmin
      .from('reports')
      .select()
      .eq('user_id', userId)
    return Response.json(data)
  }),
}
```

### Server-to-server

```ts
// Only accept the "automations" named secret key
export default {
  fetch: withSupabase({ allow: 'secret:automations' }, async (req, ctx) => {
    const body = await req.json()
    const { data } = await ctx.supabaseAdmin
      .from('scheduled_tasks')
      .insert({ name: body.taskName })
    return Response.json({ success: true, data })
  }),
}
```

The caller sends the secret key in the `apikey` header:

```ts
await fetch('https://<project>.supabase.co/functions/v1/my-function', {
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
    apikey: 'sb_secret_...', // the "automations" secret key
  },
  body: JSON.stringify({ taskName: 'cleanup' }),
})
```

## Auth Modes

| Mode               | Credential            | Use case                                            |
| ------------------ | --------------------- | --------------------------------------------------- |
| `"user"` (default) | Valid JWT             | Authenticated user endpoints                        |
| `"public"`         | Valid publishable key | Client-facing, key-validated endpoints              |
| `"secret"`         | Valid secret key      | Server-to-server, internal calls                    |
| `"always"`         | None                  | Open endpoints, wrappers that handle their own auth |

Array syntax (`allow: ["user", "secret"]`) accepts multiple auth methods — first match wins.

Named key validation: `allow: "public:web_app"` or `allow: "secret:automations"` validates against a specific named key in `SUPABASE_PUBLISHABLE_KEYS` or `SUPABASE_SECRET_KEYS`.

> **Supabase Edge Functions:** By default, the platform requires a valid JWT on every request. If your function uses `allow: 'public'`, `allow: 'secret'`, or `allow: 'always'`, disable the platform-level JWT check in `supabase/config.toml`:
>
> ```toml
> [functions.my-function]
> verify_jwt = false
> ```

## Context

Every handler receives a `SupabaseContext`:

```ts
interface SupabaseContext {
  supabase: SupabaseClient // RLS-scoped (user or anon depending on auth)
  supabaseAdmin: SupabaseClient // Bypasses RLS
  userClaims: UserClaims | null // JWT-derived identity (for full User, call supabase.auth.getUser())
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
    cors: false, // disable CORS (default: supabase-js CORS headers)
    env: { url: '...' }, // env overrides (optional)
  },
  handler,
)
```

`cors` defaults to the standard [supabase-js CORS headers](https://supabase.com/docs/guides/functions/cors). Pass a `Record<string, string>` to set custom headers, or `false` to disable CORS handling (e.g. when using a framework that handles CORS separately).

```ts
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
```

`env` overrides environment variable resolution. Defaults to reading `SUPABASE_URL`, `SUPABASE_PUBLISHABLE_KEYS`, `SUPABASE_SECRET_KEYS`, and `SUPABASE_JWKS` from the runtime environment.

## Framework Adapters

### Hono

```ts
import { Hono } from 'hono'
import { withSupabase } from '@supabase/server/adapters/hono'

const app = new Hono()

app.get('/todos', withSupabase({ allow: 'user' }), async (c) => {
  const { supabase: sb } = c.var.supabaseContext
  const { data } = await sb.from('todos').select()
  return c.json(data)
})

app.get('/health', (c) => c.json({ status: 'ok' }))

export default { fetch: app.fetch }
```

The adapter does not handle CORS — use `hono/cors` for that. Per-route auth works naturally by applying the middleware to specific routes.

## Primitives

For when you need more control than `withSupabase` provides — multiple routes with different auth, custom response headers, or building your own wrapper.

All primitives are available from `@supabase/server/core`.

```ts
import {
  verifyAuth,
  createContextClient,
  createAdminClient,
} from '@supabase/server/core'
```

### verifyAuth

Extracts credentials from a Request and validates against the allow config.

```ts
const { data: auth, error } = await verifyAuth(req, { allow: 'user' })
if (error) {
  return Response.json({ message: error.message }, { status: error.status })
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
import { verifyAuth, createContextClient } from '@supabase/server/core'

export default {
  fetch: async (req) => {
    const url = new URL(req.url)

    if (url.pathname === '/health') {
      return Response.json({ status: 'ok' })
    }

    if (url.pathname === '/todos') {
      const { data: auth, error } = await verifyAuth(req, { allow: 'user' })
      if (error)
        return Response.json(
          { message: error.message },
          { status: error.status },
        )

      const supabase = createContextClient(auth.token)
      const { data } = await supabase.from('todos').select()
      return Response.json(data)
    }

    return new Response('Not found', { status: 404 })
  },
}
```

## Environment Variables

Automatically available in Supabase Edge Functions:

| Variable                    | Format                                                        | Description                           |
| --------------------------- | ------------------------------------------------------------- | ------------------------------------- |
| `SUPABASE_URL`              | `https://<ref>.supabase.co`                                   | Your project URL                      |
| `SUPABASE_PUBLISHABLE_KEYS` | `{"default":"sb_publishable_...","web":"sb_publishable_..."}` | Publishable API keys (named)          |
| `SUPABASE_SECRET_KEYS`      | `{"default":"sb_secret_...","web":"sb_secret_..."}`           | Secret API keys (named)               |
| `SUPABASE_JWKS`             | `{"keys":[...]}` or `[...]`                                   | JSON Web Key Set for JWT verification |

Also supported (for local dev, self-hosted, or other runtimes):

| Variable                   | Format               | Description            |
| -------------------------- | -------------------- | ---------------------- |
| `SUPABASE_PUBLISHABLE_KEY` | `sb_publishable_...` | Single publishable key |
| `SUPABASE_SECRET_KEY`      | `sb_secret_...`      | Single secret key      |

When both singular and plural forms are set, plural takes priority.

For other environments, pass overrides via the `env` config option or `resolveEnv()`.

## Runtimes

- **Supabase Edge Functions** — environment variables are auto-injected. Zero config.
- **Deno / Bun** — works out of the box with the `export default { fetch }` pattern.
- **Node.js** — use the [Hono adapter](#hono) or [core primitives](#primitives) with your framework of choice.
- **Cloudflare Workers** — enable `nodejs_compat` in `wrangler.toml` or pass env overrides via the `env` config option.
- **Next.js / Nuxt / SvelteKit / Remix** — use core primitives to build a cookie-based auth adapter. See [`docs/ssr-frameworks.md`](docs/ssr-frameworks.md).

## Exports

| Export                           | What's in it                                                                                                      |
| -------------------------------- | ----------------------------------------------------------------------------------------------------------------- |
| `@supabase/server`               | `withSupabase`, `createSupabaseContext`                                                                           |
| `@supabase/server/core`          | `verifyAuth`, `verifyCredentials`, `extractCredentials`, `createContextClient`, `createAdminClient`, `resolveEnv` |
| `@supabase/server/adapters/hono` | `withSupabase` (Hono middleware)                                                                                  |

## Documentation

| Question                                                 | Doc file                                                         |
| -------------------------------------------------------- | ---------------------------------------------------------------- |
| How do I create a basic endpoint?                        | [`docs/getting-started.md`](docs/getting-started.md)             |
| What auth modes are available? Array syntax? Named keys? | [`docs/auth-modes.md`](docs/auth-modes.md)                       |
| How do I use this with Hono?                             | [`docs/hono-adapter.md`](docs/hono-adapter.md)                   |
| How do I use low-level primitives for custom flows?      | [`docs/core-primitives.md`](docs/core-primitives.md)             |
| How do environment variables work across runtimes?       | [`docs/environment-variables.md`](docs/environment-variables.md) |
| How do I handle errors? What codes exist?                | [`docs/error-handling.md`](docs/error-handling.md)               |
| How do I get typed database queries?                     | [`docs/typescript-generics.md`](docs/typescript-generics.md)     |
| How do I use this in Next.js, Nuxt, SvelteKit, or Remix? | [`docs/ssr-frameworks.md`](docs/ssr-frameworks.md)               |
| What's the complete API surface?                         | [`docs/api-reference.md`](docs/api-reference.md)                 |

## Development

```bash
pnpm install
pnpm dev
```

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md) for development workflow, commit conventions, and release process.

## License

MIT
