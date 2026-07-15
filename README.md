# @supabase/server

[![License](https://img.shields.io/npm/l/nx.svg?style=flat-square)](./LICENSE)
[![Package](https://img.shields.io/npm/v/@supabase/server)](https://www.npmjs.com/package/@supabase/server)
[![pkg.pr.new](https://pkg.pr.new/badge/supabase/server)](https://pkg.pr.new/~/supabase/server)
[![Docs](https://img.shields.io/badge/docs-supabase.github.io-3ECF8E?logo=readthedocs&logoColor=white)](https://supabase.github.io/server/)

> **v1.X — Public Beta.** First stable release under SemVer: breaking changes only ship as a major bump. The package is still early — expect new adapters, ergonomic improvements, and features to land frequently in minor releases. Found a rough edge? [Open an issue](https://github.com/supabase/server/issues) or [submit a PR](https://github.com/supabase/server/blob/main/CONTRIBUTING.md).

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
// auth: 'publishable' validates the apikey header against a publishable key —
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

Array syntax (`auth: ["user", "secret"]`) accepts multiple auth methods — first match wins. An absent credential falls through to the next mode; a present-but-invalid JWT rejects the request (no silent downgrade).

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

## Framework Adapters

Adapters wrap `withSupabase` for a specific framework's middleware contract. They ship inside `@supabase/server`, so a single `npm install @supabase/server` covers the framework you're using — no separate package per adapter.

> **Adapters are a community-driven initiative.** They're developed, maintained, and evolved by contributors — including responding to upstream framework changes. See [`src/adapters/README.md`](src/adapters/README.md) for the contribution requirements (tests, types, docs, build wiring) if you'd like to add or help maintain one.

| Framework | Import                             | Framework version      | Docs                                               |
| --------- | ---------------------------------- | ---------------------- | -------------------------------------------------- |
| Hono      | `@supabase/server/adapters/hono`   | `^4.0.0`               | [docs/adapters/hono.md](docs/adapters/hono.md)     |
| H3 / Nuxt | `@supabase/server/adapters/h3`     | `^2.0.0`               | [docs/adapters/h3.md](docs/adapters/h3.md)         |
| Elysia    | `@supabase/server/adapters/elysia` | `^1.4.0`               | [docs/adapters/elysia.md](docs/adapters/elysia.md) |
| NestJS    | `@supabase/server/adapters/nestjs` | `^10.0.0 \|\| ^11.0.0` | [docs/adapters/nestjs.md](docs/adapters/nestjs.md) |

See the per-adapter docs above for setup, per-route auth, CORS, error handling, and other patterns.

### Elysia

```ts
import { Elysia } from 'elysia'
import { withSupabase } from '@supabase/server/adapters/elysia'

const app = new Elysia()
  // Protected — plugin resolves supabaseContext before handlers run
  .use(withSupabase({ auth: 'user' }))
  .get('/games', async ({ supabaseContext }) => {
    const { data: myGames } = await supabaseContext.supabase
      .from('favorite_games')
      .select()
    return myGames
  })
  // Public — no plugin means no auth
  .get('/health', () => ({ status: 'ok' }))

app.listen(3000)
```

For per-route auth, use scoped groups:

```ts
import { Elysia } from 'elysia'
import { withSupabase } from '@supabase/server/adapters/elysia'

const app = new Elysia()
  .get('/health', () => ({ status: 'ok' }))
  .group('/api', (app) =>
    app
      .use(withSupabase({ auth: 'user' }))
      .get('/profile', async ({ supabaseContext }) => {
        return supabaseContext.userClaims
      }),
  )

app.listen(3000)
```

The adapter does not handle CORS — use `@elysiajs/cors` for that.

### NestJS

```ts
import { Controller, Get, UseGuards } from '@nestjs/common'
import { withSupabase, SupabaseCtx } from '@supabase/server/adapters/nestjs'
import type { SupabaseContext } from '@supabase/server'

@Controller('games')
@UseGuards(withSupabase({ auth: 'user' }))
export class GamesController {
  @Get()
  list(@SupabaseCtx() ctx: SupabaseContext) {
    return ctx.supabase.from('favorite_games').select()
  }
}
```

See [docs/adapters/nestjs.md](docs/adapters/nestjs.md) for per-route auth, exception filters, CORS, and more.

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

When both singular and plural forms are set, plural takes priority.

For other environments, pass overrides via the `env` config option or `resolveEnv()`. See [`docs/environment-variables.md`](docs/environment-variables.md) for details.

## Runtimes

`@supabase/server` runs anywhere standard Web `fetch` does — pick the row that matches your deployment target.

| Target                      | Notes                                                                                                                                     |
| --------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------- |
| **Supabase Edge Functions** | Zero config — environment variables are auto-injected.                                                                                    |
| **Vercel Functions**        | Edge runtime: `export default { fetch }`. Node runtime: use a [framework adapter](#framework-adapters) or [core primitives](#primitives). |
| **Cloudflare Workers**      | Enable `nodejs_compat` in `wrangler.toml`, or pass overrides via the `env` config option.                                                 |
| **Deno / Bun**              | Works out of the box via `export default { fetch }`.                                                                                      |
| **Node.js**                 | Use a [framework adapter](#framework-adapters) or [core primitives](#primitives) with your framework of choice.                           |

Using a framework? See [Framework Adapters](#framework-adapters) for Hono, H3 / Nuxt, and Elysia, or [`docs/ssr-frameworks.md`](docs/ssr-frameworks.md) for Next.js / SvelteKit / Remix (compose with [`@supabase/ssr`](https://github.com/supabase/ssr)).

### Does this replace `@supabase/ssr`?

No. `@supabase/ssr` handles cookie-based session management for frameworks like Next.js and SvelteKit. `@supabase/server` handles stateless, header-based auth for Edge Functions, Workers, and other backend runtimes. The composable primitives already work in SSR environments but require more setup — see [`docs/ssr-frameworks.md`](docs/ssr-frameworks.md) for the Next.js example. The two packages coexist and are not replacements for each other. Deeper integration with `@supabase/ssr` is on the roadmap.

## Exports

| Export                             | What's in it                                                                                                      |
| ---------------------------------- | ----------------------------------------------------------------------------------------------------------------- |
| `@supabase/server`                 | `withSupabase`, `createSupabaseContext`                                                                           |
| `@supabase/server/core`            | `verifyAuth`, `verifyCredentials`, `extractCredentials`, `createContextClient`, `createAdminClient`, `resolveEnv` |
| `@supabase/server/adapters/hono`   | `withSupabase` (Hono middleware)                                                                                  |
| `@supabase/server/adapters/h3`     | `withSupabase` (H3 / Nuxt middleware)                                                                             |
| `@supabase/server/adapters/elysia` | `withSupabase` (Elysia plugin)                                                                                    |
| `@supabase/server/adapters/nestjs` | `withSupabase` (NestJS guard), `SupabaseCtx` (param decorator)                                                    |

## Documentation

| Question                                                            | Doc file                                                         |
| ------------------------------------------------------------------- | ---------------------------------------------------------------- |
| How do I create a basic endpoint?                                   | [`docs/getting-started.md`](docs/getting-started.md)             |
| What auth modes are available? Array syntax? Named keys?            | [`docs/auth-modes.md`](docs/auth-modes.md)                       |
| Which framework adapters exist? How do I contribute one?            | [`src/adapters/README.md`](src/adapters/README.md)               |
| How do I use this with Hono?                                        | [`docs/adapters/hono.md`](docs/adapters/hono.md)                 |
| How do I use this with H3 / Nuxt?                                   | [`docs/adapters/h3.md`](docs/adapters/h3.md)                     |
| How do I use this with Elysia?                                      | [`docs/adapters/elysia.md`](docs/adapters/elysia.md)             |
| How do I use this with NestJS?                                      | [`docs/adapters/nestjs.md`](docs/adapters/nestjs.md)             |
| How do I use low-level primitives for custom flows?                 | [`docs/core-primitives.md`](docs/core-primitives.md)             |
| How do environment variables work across runtimes?                  | [`docs/environment-variables.md`](docs/environment-variables.md) |
| How do I handle errors? What codes exist?                           | [`docs/error-handling.md`](docs/error-handling.md)               |
| How do I get typed database queries?                                | [`docs/typescript-generics.md`](docs/typescript-generics.md)     |
| How do I use this with `@supabase/ssr` (Next.js, SvelteKit, Remix)? | [`docs/ssr-frameworks.md`](docs/ssr-frameworks.md)               |
| What's the complete API surface?                                    | [`docs/api-reference.md`](docs/api-reference.md)                 |

## Development

```bash
pnpm install
pnpm dev
```

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md) for development workflow, commit conventions, and release process.

## License

MIT
