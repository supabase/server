# Elysia Adapter

## Setup

Install Elysia as a peer dependency:

```bash
pnpm add elysia
```

The adapter exports its own `withSupabase` that returns an Elysia plugin instead of a fetch handler.

## Basic app with auth

```ts
import { Elysia } from 'elysia'
import { withSupabase } from '@supabase/server/adapters/elysia'

const app = new Elysia()
  .use(withSupabase({ allow: 'user' }))
  .get('/todos', async ({ supabaseContext }) => {
    const { data } = await supabaseContext.supabase.from('todos').select()
    return data
  })

app.listen(3000)
```

The context is available as `supabaseContext` in your route handlers and contains the same `SupabaseContext` fields as the main `withSupabase` wrapper: `supabase`, `supabaseAdmin`, `userClaims`, `claims`, and `authType`.

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
      .use(withSupabase({ allow: 'user' }))
      .get('/todos', async ({ supabaseContext }) => {
        const { data } = await supabaseContext.supabase.from('todos').select()
        return data
      }),
  )
  // Secret-key-protected admin routes
  .group('/admin', (app) =>
    app
      .use(withSupabase({ allow: 'secret' }))
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
  .use(withSupabase({ allow: 'user' }))
  .get('/todos', async ({ supabaseContext }) => {
    const { data } = await supabaseContext.supabase.from('todos').select()
    return data
  })

app.listen(3000)
```

## Error handling

When auth fails, the plugin throws an error with the correct HTTP status code set. The original `AuthError` is available via `error.cause` in an `onError` handler:

```ts
import { Elysia } from 'elysia'
import { withSupabase } from '@supabase/server/adapters/elysia'

const app = new Elysia()
  .use(withSupabase({ allow: 'user' }))
  .onError(({ code, error, status }) => {
    if (code !== 'SupabaseAuthError') return
    const cause = error.cause as { code?: string; status?: number } | undefined
    return status((cause?.status as 401) ?? 500, {
      error: error.message,
      code: cause?.code,
    })
  })
  .get('/todos', async ({ supabaseContext }) => {
    const { data } = await supabaseContext.supabase.from('todos').select()
    return data
  })

app.listen(3000)
```

Without a custom `onError`, Elysia uses the `status` property on the thrown error to set the response status automatically (401 for auth failures, 500 for internal errors).

## Environment overrides

Pass `env` to override auto-detected environment variables, same as the main wrapper:

```ts
app.use(withSupabase({ allow: 'user', env: { url: 'http://localhost:54321' } }))
```

## Supabase client options

Forward options to the underlying `createClient()` calls:

```ts
app.use(
  withSupabase({
    allow: 'user',
    supabaseOptions: { db: { schema: 'api' } },
  }),
)
```
