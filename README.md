# @supabase/server

[![License](https://img.shields.io/npm/l/nx.svg?style=flat-square)](./LICENSE)
[![Package](https://img.shields.io/npm/v/@supabase/server)](https://www.npmjs.com/package/@supabase/server)
[![pkg.pr.new](https://pkg.pr.new/badge/supabase/server)](https://pkg.pr.new/~/supabase/server)
[![Docs](https://img.shields.io/badge/docs-supabase.github.io-3ECF8E?logo=readthedocs&logoColor=white)](https://supabase.github.io/server/)

> **Coming from a `0.x` release?** See [MIGRATION.md](MIGRATION.md) for the v0 → v1 rename map (`allow` → `auth`, `'public'` → `'publishable'`, `authType` → `authMode`, `claims` → `jwtClaims`, …).

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
import { withSupabase } from "npm:@supabase/server@2";

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

Imagine you're building an app where users track their favorite games. They sign in and manage their own list. Pre-login screens browse the public catalog. An admin dashboard curates featured titles. A cron job refreshes the "popular this week" rankings. Here's how each piece looks:

### Authenticated endpoint

```ts
// A signed-in user fetches their favorite games.
export default {
  fetch: withSupabase({ auth: 'user' }, async (_req, ctx) => {
    const { supabase, supabaseAdmin, userClaims, jwtClaims, authMode } = ctx
    // supabase       — RLS-scoped to the authenticated user
    // supabaseAdmin  — bypasses RLS (service role)
    // userClaims     — user identity from JWT (id, email, role)
    // jwtClaims      — full JWT claims
    // authMode       — which auth mode matched

    // RLS-scoped — this user only sees their own favorites
    const { data: myGames } = await supabase.from('favorite_games').select()
    return Response.json(myGames)
  }),
}
```

### Public endpoint (no auth)

```ts
// The frontend hits this before showing the login screen.
// auth: 'none' means no credentials required.
export default {
  fetch: withSupabase({ auth: 'none' }, async (_req, _ctx) => {
    return Response.json({ status: 'ok' })
  }),
}
```

### Publishable-key endpoint

```ts
// The mobile app browses the game catalog before the user signs in.
// auth: 'publishable' validates the apikey header against the 'default' publishable key —
// gating the endpoint to your own clients while staying anonymous to the DB.
export default {
  fetch: withSupabase({ auth: 'publishable' }, async (_req, ctx) => {
    // ctx.supabase  — anonymous (anon role); RLS still applies
    // ctx.userClaims, ctx.jwtClaims — null (no JWT)
    // ctx.authMode === 'publishable', ctx.authKeyName === 'default'
    const { data: catalog } = await ctx.supabase
      .from('games')
      .select('id, name, cover_url')
    return Response.json(catalog)
  }),
}
```

The mobile app sends the publishable key in the `apikey` header:

```ts
const catalogEndpoint = 'https://<project>.supabase.co/functions/v1/catalog'
const publishableKey = 'sb_publishable_...'

await fetch(catalogEndpoint, { headers: { apikey: publishableKey } })
```

> Unlike `auth: 'secret'`, the `supabase` client here is anonymous, not admin — RLS is the source of truth for what's visible. The publishable key acts as a coarse "this request came from a known client" gate; it isn't a user identity.

### API key protected

```ts
// An admin dashboard fetches the list of featured games to curate.
// auth: 'secret' validates the apikey header against the 'default' secret key
// (not a user JWT) — supabaseAdmin bypasses RLS.
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
    const callerIsUser = ctx.authMode === 'user'

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

| Mode               | Credential                      | Use case                                            |
| ------------------ | ------------------------------- | --------------------------------------------------- |
| `"user"` (default) | Valid JWT                       | Authenticated user endpoints                        |
| `"publishable"`    | Valid `default` publishable key | Client-facing, key-validated endpoints              |
| `"secret"`         | Valid `default` secret key      | Server-to-server, internal calls                    |
| `"none"`           | None                            | Open endpoints, wrappers that handle their own auth |

Array syntax (`auth: ["user", "secret"]`) accepts multiple auth methods — first match wins. An absent credential falls through to the next mode; a present-but-invalid JWT rejects the request (no silent downgrade). Because `"none"` matches every request, it is only accepted on its own or as the last entry of a list (`auth: ["user", "none"]` — optional user).

Named key validation: `auth: "publishable:web_app"` or `auth: "secret:automations"` validates against a specific named key in `SUPABASE_PUBLISHABLE_KEYS` or `SUPABASE_SECRET_KEYS`. Bare `auth: "secret"` (or `"publishable"`) matches only the `default` key; use the wildcard `auth: "secret:*"` to accept any key in the set. See [`docs/auth-modes.md`](docs/auth-modes.md).

> **Supabase Edge Functions:** By default, the platform requires a valid JWT on every request. If your function uses `auth: 'publishable'`, `auth: 'secret'`, or `auth: 'none'`, disable the platform-level JWT check in `supabase/config.toml`:
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
  jwtClaims: JWTClaims | null // Present when auth is JWT
  authMode: AuthMode // Which auth mode matched
  authKeyName?: string // Auth key name of the API key that was used for this request (omitted for `'user'` / `'none'`)
}
```

`supabase` is always the safe client — it respects RLS. When `authMode` is `"user"`, it's scoped to that user's permissions. Otherwise, it's initialized as anonymous.

`supabaseAdmin` always bypasses RLS. Use it for operations that need full database access.

## Config

```ts
withSupabase(
  {
    auth: 'user', // who can call this function
    cors: 'disabled', // disable CORS (default: supabase-js CORS headers)
    env: { url: '...' }, // env overrides (optional)
  },
  handler,
)
```

`cors` accepts `'default'` (the standard [supabase-js CORS headers](https://supabase.com/docs/guides/functions/cors), also the default), `'disabled'` to disable CORS handling (e.g. when using a framework that handles CORS separately), or `{ headers }` to set custom headers. The boolean (`true`/`false`) and bare `Record<string, string>` forms are deprecated but still accepted.

```ts
withSupabase(
  {
    auth: 'user',
    cors: {
      headers: {
        'Access-Control-Allow-Origin': 'https://myapp.com',
        'Access-Control-Allow-Headers': 'authorization, content-type',
      },
    },
  },
  handler,
)
```

`env` overrides environment variable resolution. Defaults to reading `SUPABASE_URL`, `SUPABASE_PUBLISHABLE_KEYS`, `SUPABASE_SECRET_KEYS`, and `SUPABASE_JWKS` from the runtime environment.

`audience` and `issuer` pin the `aud` and `iss` claims of a `user`-mode token. Each takes a string or an array. A token that lacks the claim, or carries a value outside the list, is rejected with `INVALID_JWT`. Supabase Auth sets `aud` to `authenticated` and `iss` to `https://<project-ref>.supabase.co/auth/v1`, so `issuer: fromSupabaseUrl(url)` limits an endpoint to tokens from one project.

```ts
import { fromSupabaseUrl, withSupabase } from '@supabase/server'

withSupabase(
  {
    auth: 'user',
    issuer: fromSupabaseUrl('https://<project-ref>.supabase.co'),
  },
  handler,
)
```

Called with config only, `withSupabase(config)` returns an entry for `pipeline` from `@supabase/middleware`. Entries placed after it in the array receive the Supabase context and contribute their own typed keys; entries placed before it run ahead of the auth gate. The first-party entries live on the `@supabase/server/middleware/*` subpaths; see [Postgres](#postgres-rls-scoped-queries).

## Frameworks

To run `@supabase/server`'s middleware entries inside Hono, H3 / Nuxt, Elysia, NestJS, or TanStack Start, copy the bridge for your framework from [`examples/frameworks/`](https://github.com/supabase/server/tree/main/examples/frameworks) into your project. A bridge is one file you own, and it runs a `@supabase/middleware` entry array in your framework's own middleware slot.

```ts
import { Hono } from 'hono'
import { withRequiredClaims } from '@supabase/server/middleware/required-claims'
import { withSupabaseClient } from '@supabase/server/middleware/client'

import { toHono } from './lib/supabase-middleware.js'

const app = new Hono()
  .use('*', toHono([withRequiredClaims(), withSupabaseClient()]))
  .get('/games', async (c) => {
    const { data, error } = await c.var.supabase.from('favorite_games').select()
    if (error) return c.json({ error: error.message }, 500)
    return c.json(data)
  })
```

`.use('*', ...)` gates every route registered after it in the same chain, a health check included. A public route goes in its own sub-app, mounted with `app.route()`.

The [Frameworks guide](https://supabase.com/docs/reference/server/frameworks) covers each bridge, which frameworks keep the response phase, and how to scope one entry array to a group of routes.

> [!WARNING]
> The framework adapters (`@supabase/server/adapters/*`) were deprecated in 1.9.0 and removed in 2.0.0.
>
> [Moving off the adapters](https://supabase.com/docs/reference/server/frameworks#moving-off-the-adapters) has the migration. One step to get right first: `withRequiredClaims()` replaces `auth: 'user'`. `withClaims()` looks like the replacement but lets anonymous requests through, turning a 401 into a silent 200.

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
const userScopedClient = createContextClient({ auth: { token: auth.token } }) // RLS applies as this user
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

      const userScopedClient = createContextClient({
        auth: { token: result.token, keyName: result.keyName },
      })
      const { data: myGames } = await userScopedClient
        .from('favorite_games')
        .select()
      return Response.json(myGames)
    }

    return new Response('Not found', { status: 404 })
  },
}
```

## Postgres (RLS-scoped queries)

When PostgREST isn't the right tool — joins, CTEs, window functions — `withPostgresClient` puts a direct Postgres connection on `ctx.postgres`, scoped to the caller by RLS:

```ts
import { pipeline } from '@supabase/middleware'
import { withSupabase } from '@supabase/server'
import { withPostgresClient } from '@supabase/server/middleware/postgres'

export default {
  fetch: pipeline(
    [withSupabase({ auth: 'user' }), withPostgresClient()],
    async (_req, ctx) => {
      // No WHERE clause — RLS scopes the rows to the caller.
      const notes = await ctx.postgres.query`select id, body from notes`
      return Response.json(notes)
    },
  ),
}
```

Each query runs in its own transaction that injects the caller's claims and drops to their role, exactly like PostgREST — so `auth.uid()` resolves and your policies enforce. Only `authenticated` and `anon` are assumed; a token naming any other role (including `service_role`, and custom roles) is refused with `code: 'UNSUPPORTED_ROLE'` rather than silently downgraded to `anon`.

When a handler legitimately needs to cross user boundaries, `withPostgresAdminClient` is the explicit opt-out — it contributes `ctx.postgresAdmin`, which bypasses RLS and needs no caller identity, so it works under `auth: 'secret'` and `auth: 'none'` too:

```ts
import { withPostgresAdminClient } from '@supabase/server/middleware/postgres-admin'

pipeline([withSupabase({ auth: 'secret' }), withPostgresAdminClient()], handler)
```

The pair mirrors `ctx.supabase` / `ctx.supabaseAdmin`, and they share one connection pool. Keeping them as two middleware is deliberate: bypassing RLS stays visible at the composition site, so you can grep for every handler that can do it.

Needs `pg` installed (optional peer dependency) and a raw TCP socket: Node, Deno, Bun, and the Supabase Edge runtime — **not** Workers-style isolates. Reads `SUPABASE_DB_URL` by default. Remember that `authenticated` also needs table grants, not just policies.

See [`docs/postgres.md`](docs/postgres.md) for standalone composition with `withClaims`, the grants requirement, and current limits.

## Environment Variables

Automatically available in Supabase Edge Functions:

| Variable                    | Format                                                        | Description                                  |
| --------------------------- | ------------------------------------------------------------- | -------------------------------------------- |
| `SUPABASE_URL`              | `https://<ref>.supabase.co`                                   | Your project URL                             |
| `SUPABASE_PUBLISHABLE_KEYS` | `{"default":"sb_publishable_...","web":"sb_publishable_..."}` | Publishable API keys (named)                 |
| `SUPABASE_SECRET_KEYS`      | `{"default":"sb_secret_...","web":"sb_secret_..."}`           | Secret API keys (named)                      |
| `SUPABASE_JWKS`             | `{"keys":[...]}` or `[...]`                                   | Inline JSON Web Key Set for JWT verification |

Also supported (for local dev, self-hosted, or other runtimes):

| Variable                   | Format               | Description                                               |
| -------------------------- | -------------------- | --------------------------------------------------------- |
| `SUPABASE_PUBLISHABLE_KEY` | `sb_publishable_...` | Single publishable key                                    |
| `SUPABASE_SECRET_KEY`      | `sb_secret_...`      | Single secret key                                         |
| `SUPABASE_JWKS_URL`        | `https://...`        | Remote JWKS endpoint (used when `SUPABASE_JWKS` is unset) |
| `SUPABASE_DB_URL`          | `postgresql://...`   | Postgres connection string, read by `withPostgresClient`  |

When both singular and plural forms are set, plural takes priority.

For other environments, pass overrides via the `env` config option or `resolveEnv()`. See [`docs/environment-variables.md`](docs/environment-variables.md) for details.

## Runtimes

`@supabase/server` runs anywhere standard Web `fetch` does — pick the row that matches your deployment target.

| Target                      | Notes                                                                                                                            |
| --------------------------- | -------------------------------------------------------------------------------------------------------------------------------- |
| **Supabase Edge Functions** | Zero config — environment variables are auto-injected.                                                                           |
| **Vercel Functions**        | Edge runtime: `export default { fetch }`. Node runtime: use a [framework bridge](#frameworks) or [core primitives](#primitives). |
| **Cloudflare Workers**      | Enable `nodejs_compat` in `wrangler.toml`, or pass overrides via the `env` config option.                                        |
| **Deno / Bun**              | Works out of the box via `export default { fetch }`.                                                                             |
| **Node.js**                 | Use a [framework bridge](#frameworks) or [core primitives](#primitives) with your framework of choice.                           |

Using a framework? See [Frameworks](#frameworks) for Hono, H3 / Nuxt, Elysia, NestJS, and TanStack Start, or [`docs/ssr-frameworks.md`](docs/ssr-frameworks.md) for Next.js / SvelteKit / Remix (compose with [`@supabase/ssr`](https://github.com/supabase/ssr)).

### Does this replace `@supabase/ssr`?

No. `@supabase/ssr` handles cookie-based session management for frameworks like Next.js and SvelteKit. `@supabase/server` handles stateless, header-based auth for Edge Functions, Workers, and other backend runtimes. The composable primitives already work in SSR environments but require more setup — see [`docs/ssr-frameworks.md`](docs/ssr-frameworks.md) for the Next.js example. The two packages coexist and are not replacements for each other. Deeper integration with `@supabase/ssr` is on the roadmap.

## Exports

| Export                                        | What's in it                                                                                                                          |
| --------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------- |
| `@supabase/server`                            | `withSupabase`, `createSupabaseContext`                                                                                               |
| `@supabase/server/core`                       | `verifyAuth`, `verifyCredentials`, `extractCredentials`, `createContextClient`, `createAdminClient`, `resolveEnv`                     |
| `@supabase/server/middleware/client`          | `withSupabaseClient` (RLS-scoped `ctx.supabase` client)                                                                               |
| `@supabase/server/middleware/admin-client`    | `withSupabaseAdminClient` (`ctx.supabaseAdmin`, bypasses RLS)                                                                         |
| `@supabase/server/middleware/claims`          | `withClaims` (JWKS-verified `ctx.jwtClaims`)                                                                                          |
| `@supabase/server/middleware/required-claims` | `withRequiredClaims` (user-mode auth gate, non-null `ctx.jwtClaims`)                                                                  |
| `@supabase/server/middleware/postgres`        | `withPostgresClient` (RLS-scoped `ctx.postgres` client)                                                                               |
| `@supabase/server/middleware/postgres-admin`  | `withPostgresAdminClient` (`ctx.postgresAdmin`, bypasses RLS)                                                                         |
| `@supabase/server/oauth-protected-resource`   | `withOAuthProtectedResource`, `fromSupabaseUrl`, `resourceMetadataResponse`, `unauthorizedResponse`; see [`docs/mcp.md`](docs/mcp.md) |
| `@supabase/server/peer/supabase-js`           | Re-exported `supabase-js` types (`SupabaseClient`, `PostgrestError`, …)                                                               |

## Documentation

| Question                                                                                   | Doc file                                                                          |
| ------------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------- |
| How do I create a basic endpoint?                                                          | [`docs/getting-started.md`](docs/getting-started.md)                              |
| What auth modes are available? Array syntax? Named keys?                                   | [`docs/auth-modes.md`](docs/auth-modes.md)                                        |
| How do I run this inside Hono, H3 / Nuxt, Elysia, NestJS, or TanStack Start?               | [Frameworks](#frameworks)                                                         |
| How do I use low-level primitives for custom flows?                                        | [`docs/core-primitives.md`](docs/core-primitives.md)                              |
| How do environment variables work across runtimes?                                         | [`docs/environment-variables.md`](docs/environment-variables.md)                  |
| How do I handle errors? What codes exist?                                                  | [`docs/error-handling.md`](docs/error-handling.md)                                |
| How do I get typed database queries?                                                       | [`docs/typescript-generics.md`](docs/typescript-generics.md)                      |
| How do I run raw SQL scoped to the caller by RLS?                                          | [`docs/postgres.md`](docs/postgres.md)                                            |
| Why does a Postgres query hang, return zero rows, or get my project blocked at the pooler? | [`docs/postgres.md#troubleshooting`](docs/postgres.md#troubleshooting)            |
| How do I use this with `@supabase/ssr` (Next.js, SvelteKit, Remix)?                        | [`docs/ssr-frameworks.md`](docs/ssr-frameworks.md)                                |
| How do I build an MCP server my users connect to (OAuth discovery, RLS-scoped tools)?      | [`docs/mcp.md`](docs/mcp.md)                                                      |
| What's the complete API surface?                                                           | [`docs/api-reference.md`](docs/api-reference.md)                                  |
| Does this library support legacy API keys or HS256 JWTs?                                   | [`docs/auth-modes.md`](docs/auth-modes.md#legacy-keys-and-jwts-are-not-supported) |

## Development

```bash
pnpm install
pnpm dev
```

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md) for development workflow, commit conventions, and release process.

## License

MIT
