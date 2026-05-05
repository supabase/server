# @supabase/server

[![License](https://img.shields.io/npm/l/nx.svg?style=flat-square)](./LICENSE)
[![Package](https://img.shields.io/npm/v/@supabase/server)](https://www.npmjs.com/package/@supabase/server)
[![pkg.pr.new](https://pkg.pr.new/badge/supabase/server)](https://pkg.pr.new/~/supabase/server)

> **Beta:** This package is under active development. APIs and documentation may change. If you find a bug or have a feature request, please [open an issue](https://github.com/supabase/server/issues) or [submit a PR](https://github.com/supabase/server/blob/main/CONTRIBUTING.md).

> **Heads up — `allow` is now `auth`.** The `allow` config option has been renamed to `auth` to better align with CLI terminology and read more naturally (e.g. `auth: 'user'`). The old `allow` key still works but is deprecated and will emit a one-time `console.warn` per process. It will be removed in a future major release. **Migration:** find-and-replace `allow:` → `auth:` in your `withSupabase`, `createSupabaseContext`, `verifyAuth`, and `verifyCredentials` calls.

`@supabase/server` gives you batteries included access to the
[supabase-js SDK](https://github.com/supabase/supabase-js), including client
creation and authentication automatically scoped to the inbound requests to your
Edge Functions and APIs.

```ts
import { withSupabase } from '@supabase/server'

export default {
  fetch: withSupabase({ auth: 'user' }, async (_req, ctx) => {
    // RLS-scoped — this user only sees their own favorites
    const { data: myGames } = await ctx.supabase.from('favorite_games').select()
    return Response.json(myGames)
  }),
}
```

One import. One line of config. Auth is validated, clients are ready, CORS is handled. Your handler only runs on successful auth.

## Installation

```bash
# Deno / Supabase Edge Functions (no install — import directly)
import { withSupabase } from "npm:@supabase/server";

# npm
npm install @supabase/server

# pnpm
pnpm add @supabase/server
```

### AI coding skills

Install the skill so your AI coding agent (Claude Code, Cursor, etc.) knows how to use this package:

```bash
npx skills add supabase/server
```

## Quick Start

Imagine you're building an app where users track their favorite games. They sign in and manage their own list. An admin dashboard curates featured titles. A cron job refreshes the "popular this week" rankings. Here's how each piece looks:

### Authenticated endpoint

```ts
// A signed-in user fetches their favorite games.
export default {
  fetch: withSupabase({ auth: 'user' }, async (_req, ctx) => {
    const { supabase, supabaseAdmin, userClaims, claims, authType } = ctx
    // supabase       — RLS-scoped to the authenticated user
    // supabaseAdmin  — bypasses RLS (service role)
    // userClaims     — user identity from JWT (id, email, role)
    // claims         — full JWT claims
    // authType       — which auth mode matched

    // RLS-scoped — this user only sees their own favorites
    const { data: myGames } = await supabase.from('favorite_games').select()
    return Response.json(myGames)
  }),
}
```

### Public endpoint (no auth)

```ts
// The frontend hits this before showing the login screen.
// auth: 'always' means no credentials required.
export default {
  fetch: withSupabase({ auth: 'always' }, async (_req, _ctx) => {
    return Response.json({ status: 'ok' })
  }),
}
```

### API key protected

```ts
// An admin dashboard fetches the list of featured games to curate.
// Secret key auth (not a user JWT) — supabaseAdmin bypasses RLS.
export default {
  fetch: withSupabase({ auth: 'secret' }, async (_req, ctx) => {
    const { data: featuredGames } = await ctx.supabaseAdmin
      .from('featured_games')
      .select()
    return Response.json(featuredGames)
  }),
}
```

### Dual auth (user or service)

```ts
// Users view their own play stats from the app (JWT).
// A backend service pulls stats for any user (secret key + user_id in body).
export default {
  fetch: withSupabase({ auth: ['user', 'secret'] }, async (req, ctx) => {
    const callerIsUser = ctx.authType === 'user'

    if (callerIsUser) {
      // RLS-scoped — the database enforces "own stats only"
      const { data: myStats } = await ctx.supabase.from('play_stats').select()
      return Response.json(myStats)
    }

    // Service path — bypass RLS to pull stats for any user
    const { user_id } = await req.json()
    const { data: playStats } = await ctx.supabaseAdmin
      .from('play_stats')
      .select()
      .eq('user_id', user_id)
    return Response.json(playStats)
  }),
}
```

### Server-to-server

```ts
// A cron job refreshes the "popular this week" list every hour.
// Named key ("cron") so it can be rotated without touching other services.
export default {
  fetch: withSupabase({ auth: 'secret:cron' }, async (_req, ctx) => {
    const oneWeekAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000)
    const { data: popularThisWeek } = await ctx.supabaseAdmin.rpc(
      'get_most_favorited_since',
      { since: oneWeekAgo.toISOString(), limit_count: 10 },
    )
    await ctx.supabaseAdmin
      .from('featured_games')
      .upsert(
        popularThisWeek.map((g) => ({ game_id: g.id, reason: 'popular' })),
      )
    return Response.json({ popularThisWeek })
  }),
}
```

The cron job sends the named secret key in the `apikey` header:

```ts
const refreshEndpoint =
  'https://<project>.supabase.co/functions/v1/refresh-popular'
const cronKey = 'sb_secret_...' // the "cron" named secret key

await fetch(refreshEndpoint, {
  method: 'POST',
  headers: { apikey: cronKey },
})
```

## Auth Modes

| Mode               | Credential            | Use case                                            |
| ------------------ | --------------------- | --------------------------------------------------- |
| `"user"` (default) | Valid JWT             | Authenticated user endpoints                        |
| `"public"`         | Valid publishable key | Client-facing, key-validated endpoints              |
| `"secret"`         | Valid secret key      | Server-to-server, internal calls                    |
| `"always"`         | None                  | Open endpoints, wrappers that handle their own auth |

Array syntax (`auth: ["user", "secret"]`) accepts multiple auth methods — first match wins. An absent credential falls through to the next mode; a present-but-invalid JWT rejects the request (no silent downgrade). See [`docs/auth-modes.md`](docs/auth-modes.md).

Named key validation: `auth: "public:web_app"` or `auth: "secret:automations"` validates against a specific named key in `SUPABASE_PUBLISHABLE_KEYS` or `SUPABASE_SECRET_KEYS`.

> **Supabase Edge Functions:** By default, the platform requires a valid JWT on every request. If your function uses `auth: 'public'`, `auth: 'secret'`, or `auth: 'always'`, disable the platform-level JWT check in `supabase/config.toml`:
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
  authKeyName?: string | null // Auth key name of the API key that was used for this request
}
```

`supabase` is always the safe client — it respects RLS. When `authType` is `"user"`, it's scoped to that user's permissions. Otherwise, it's initialized as anonymous.

`supabaseAdmin` always bypasses RLS. Use it for operations that need full database access.

## Config

```ts
withSupabase(
  {
    auth: 'user', // who can call this function
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
    auth: 'user',
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

// Protected — withSupabase middleware validates the JWT before the handler runs
app.get('/games', withSupabase({ auth: 'user' }), async (c) => {
  const { supabase } = c.var.supabaseContext
  const { data: myGames } = await supabase.from('favorite_games').select()
  return c.json(myGames)
})

// Public — no middleware means no auth
app.get('/health', (c) => c.json({ status: 'ok' }))

export default { fetch: app.fetch }
```

The adapter does not handle CORS — use `hono/cors` for that. Per-route auth works naturally by applying the middleware to specific routes.

### H3 / Nuxt

```ts
import { H3 } from 'h3'
import { withSupabase } from '@supabase/server/adapters/h3'

const app = new H3()

// Protected — withSupabase validates the JWT before the handler runs
app.use(withSupabase({ auth: 'user' }))

app.get('/games', async (event) => {
  const { supabase } = event.context.supabaseContext
  const { data: myGames } = await supabase.from('favorite_games').select()
  return myGames
})

// Public — no middleware means no auth
app.get('/health', () => ({ status: 'ok' }))

export default { fetch: app.fetch }
```

For **Nuxt**, use `defineHandler` for file routes:

```ts
// server/api/games.get.ts
import { defineHandler } from 'h3'
import { withSupabase } from '@supabase/server/adapters/h3'

export default defineHandler({
  middleware: [withSupabase({ auth: 'user' })],
  handler: async (event) => {
    const { supabase } = event.context.supabaseContext
    return supabase.from('favorite_games').select()
  },
})
```

For app-wide auth, register it as a server middleware:

```ts
// server/middleware/supabase.ts
import { withSupabase } from '@supabase/server/adapters/h3'

export default withSupabase({ auth: 'user' })
```

The adapter does not handle CORS — use H3's CORS utilities for that.

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

Extracts credentials from a Request and validates against the auth config.

```ts
const { data: auth, error } = await verifyAuth(req, { auth: 'user' })
if (error) {
  return Response.json({ message: error.message }, { status: error.status })
}
```

### verifyCredentials

Low-level — works with raw credentials instead of a Request. Used by SSR adapters and custom auth flows.

```ts
const credentials = { token: myToken, apikey: null }
const { data: result, error } = await verifyCredentials(credentials, {
  auth: 'user',
})
```

### createContextClient / createAdminClient

```ts
const userScopedClient = createContextClient(auth.token) // RLS applies as this user
const anonClient = createContextClient() // RLS applies as anon role
const adminClient = createAdminClient() // bypasses RLS entirely
```

### createSupabaseContext

Full context assembly from a Request — `verifyAuth` + client creation in one call.

```ts
const { data: ctx, error } = await createSupabaseContext(req, { auth: 'user' })
```

### resolveEnv

Resolves environment variables with optional overrides.

```ts
const { data: env, error } = resolveEnv({
  url: process.env.NEXT_PUBLIC_SUPABASE_URL,
})
```

### Example: custom multi-route handler

The same games API and health check from the Hono example, built from primitives instead of a framework:

```ts
import { verifyAuth, createContextClient } from '@supabase/server/core'

export default {
  fetch: async (req) => {
    const url = new URL(req.url)

    // Public — no auth needed
    if (url.pathname === '/health') {
      return Response.json({ status: 'ok' })
    }

    // Protected — verify the JWT, then create a user-scoped client
    if (url.pathname === '/games') {
      const { data: result, error } = await verifyAuth(req, { auth: 'user' })
      if (error)
        return Response.json(
          { message: error.message },
          { status: error.status },
        )

      const userScopedClient = createContextClient(result.token)
      const { data: myGames } = await userScopedClient
        .from('favorite_games')
        .select()
      return Response.json(myGames)
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

For other environments, pass overrides via the `env` config option or `resolveEnv()`. See [`docs/environment-variables.md`](docs/environment-variables.md) for details.

## Runtimes

- **Supabase Edge Functions** — environment variables are auto-injected. Zero config.
- **Deno / Bun** — works out of the box with the `export default { fetch }` pattern.
- **Node.js** — use the [Hono adapter](#hono), [H3 adapter](#h3--nuxt), or [core primitives](#primitives) with your framework of choice.
- **Cloudflare Workers** — enable `nodejs_compat` in `wrangler.toml` or pass env overrides via the `env` config option.
- **Nuxt** — use the [H3 adapter](#h3--nuxt) directly as a server middleware.
- **Next.js / SvelteKit / Remix** — use core primitives to build a cookie-based auth adapter. See [`docs/ssr-frameworks.md`](docs/ssr-frameworks.md).

## Exports

| Export                           | What's in it                                                                                                      |
| -------------------------------- | ----------------------------------------------------------------------------------------------------------------- |
| `@supabase/server`               | `withSupabase`, `createSupabaseContext`                                                                           |
| `@supabase/server/core`          | `verifyAuth`, `verifyCredentials`, `extractCredentials`, `createContextClient`, `createAdminClient`, `resolveEnv` |
| `@supabase/server/adapters/hono` | `withSupabase` (Hono middleware)                                                                                  |
| `@supabase/server/adapters/h3`   | `withSupabase` (H3 / Nuxt middleware)                                                                             |

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
