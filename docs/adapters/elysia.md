# Elysia Adapter

## Setup

Install Elysia as a peer dependency:

```bash
pnpm add elysia
```

The adapter exports `withSupabase` with two call shapes:

- **One arg** — `withSupabase(config)` — returns an Elysia plugin. Everything in this document describes this form.
- **Two args** — `withSupabase(config, handler)` — the base `withSupabase` from `@supabase/server`, re-exported here for ergonomics. Returns a Web Fetch handler. Use it when you want to compose with [gates](../../src/core/gates/README.md). See the "Composing with gates" section at the bottom.

## Basic app with auth

```ts
import { Elysia } from 'elysia'
import { withSupabase } from '@supabase/server/adapters/elysia'

const app = new Elysia()
  .use(withSupabase({ auth: 'user' }))
  .get('/todos', async ({ supabaseContext }) => {
    const { data } = await supabaseContext.supabase.from('todos').select()
    return data
  })

app.listen(3000)
```

The context is available as `supabaseContext` in your route handlers and contains the same `SupabaseContext` fields as the main `withSupabase` wrapper: `supabase`, `supabaseAdmin`, `userClaims`, `jwtClaims`, and `authMode`.

## Per-route auth

Apply different auth modes to different routes by using the plugin on scoped route groups:

```ts
import { Elysia } from 'elysia'
import { withSupabase } from '@supabase/server/adapters/elysia'

const app = new Elysia()
  // Public route — no auth
  .get('/health', () => ({ status: 'ok' }))
  // User-authenticated routes
  .group('/api', (app) =>
    app
      .use(withSupabase({ auth: 'user' }))
      .get('/todos', async ({ supabaseContext }) => {
        const { data } = await supabaseContext.supabase.from('todos').select()
        return data
      }),
  )
  // Secret-key-protected admin routes
  .group('/admin', (app) =>
    app
      .use(withSupabase({ auth: 'secret' }))
      .post('/sync', async ({ supabaseContext }) => {
        const { data } = await supabaseContext.supabaseAdmin
          .from('audit_log')
          .insert({ action: 'sync' })
        return data
      }),
  )

app.listen(3000)
```

## Skip behavior

If a previous plugin already resolved `supabaseContext`, subsequent `withSupabase` calls skip auth. This allows chaining plugins without redundant work.

**Important:** The plugin calls `.as('scoped')` so its `resolve` hook propagates one level up to the parent app — routes registered after `.use(withSupabase(...))` will see `supabaseContext`. The skip-if-set pattern cannot make a route stricter than an already-resolved context.

For routes that need different auth than the rest of the app, use scoped `.group()` with `.use(withSupabase(...))` without an app-wide plugin (see the "Per-route auth" section above).

## CORS

The Elysia adapter does not handle CORS — the `cors` option is excluded from its config type. Use Elysia's CORS plugin:

```ts
import { Elysia } from 'elysia'
import { cors } from '@elysiajs/cors'
import { withSupabase } from '@supabase/server/adapters/elysia'

const app = new Elysia()
  .use(cors())
  .use(withSupabase({ auth: 'user' }))
  .get('/todos', async ({ supabaseContext }) => {
    const { data } = await supabaseContext.supabase.from('todos').select()
    return data
  })

app.listen(3000)
```

## Error handling

When auth fails, the plugin throws a `SupabaseError`. The HTTP status is on `.status` directly, and the original `AuthError` is available as the typed `.cause`. Discriminate in `onError` via `code === 'SupabaseError'`:

```ts
import { Elysia } from 'elysia'
import { withSupabase } from '@supabase/server/adapters/elysia'

const app = new Elysia()
  .use(withSupabase({ auth: 'user' }))
  .onError(({ code, error, status }) => {
    if (code !== 'SupabaseError') return
    return status(error.status as 401, {
      error: error.message,
      code: error.cause.code,
    })
  })
  .get('/todos', async ({ supabaseContext }) => {
    const { data } = await supabaseContext.supabase.from('todos').select()
    return data
  })

app.listen(3000)
```

Without a custom `onError`, Elysia uses the `status` property on the thrown `SupabaseError` to set the response status automatically (401 for auth failures, 500 for internal errors).

## Environment overrides

Pass `env` to override auto-detected environment variables, same as the main wrapper:

```ts
app.use(withSupabase({ auth: 'user', env: { url: 'http://localhost:54321' } }))
```

## Supabase client options

Forward options to the underlying `createClient()` calls:

```ts
app.use(
  withSupabase({
    auth: 'user',
    supabaseOptions: { db: { schema: 'api' } },
  }),
)
```

## Composing with gates

For routes that compose with a [gate](../../src/core/gates/README.md), call `withSupabase` with two args. That form is the base `withSupabase` from `@supabase/server` — it returns a Web Fetch handler, which you mount on an Elysia route:

```ts
import { Elysia } from 'elysia'
import { withSupabase } from '@supabase/server/adapters/elysia'
import { withFeatureFlag } from '@supabase/server/gates/feature-flag'

const beta = withSupabase(
  { auth: 'user' },
  withFeatureFlag(
    { name: 'beta', evaluate: (req) => req.headers.has('x-beta') },
    async (_req, ctx) =>
      Response.json({ user: ctx.userClaims?.id, flag: ctx.featureFlag.name }),
  ),
)

new Elysia().all('/beta', ({ request }) => beta(request)).listen(3000)
```

Routes that don't need a gate continue to use the one-arg plugin form documented above. The two coexist in one app; each route picks the form that fits.
