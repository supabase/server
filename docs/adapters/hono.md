# Hono Adapter

## Setup

Install Hono as a peer dependency:

```bash
pnpm add hono
```

The adapter exports its own `withSupabase` that returns Hono middleware instead of a fetch handler.

## Basic app with auth

```ts
import { Hono } from 'hono'
import { withSupabase } from '@supabase/server/adapters/hono'

const app = new Hono()

// Apply auth to all routes
app.use('*', withSupabase({ auth: 'user' }))

app.get('/todos', async (c) => {
  const { supabase } = c.var.supabaseContext
  const { data } = await supabase.from('todos').select()
  return c.json(data)
})

app.get('/profile', async (c) => {
  const { supabase, userClaims } = c.var.supabaseContext
  const { data } = await supabase
    .from('profiles')
    .select()
    .eq('id', userClaims!.id)
  return c.json(data)
})

export default { fetch: app.fetch }
```

The context is stored in `c.var.supabaseContext` and contains the same `SupabaseContext` fields as the main `withSupabase` wrapper: `supabase`, `supabaseAdmin`, `userClaims`, `jwtClaims`, and `authMode`.

## Per-route auth

Apply different auth modes to different routes by using the middleware inline:

```ts
import { Hono } from 'hono'
import { withSupabase } from '@supabase/server/adapters/hono'

const app = new Hono()

// Public route — no auth
app.get('/health', (c) => c.json({ status: 'ok' }))

// User-authenticated route
app.get('/todos', withSupabase({ auth: 'user' }), async (c) => {
  const { supabase } = c.var.supabaseContext
  const { data } = await supabase.from('todos').select()
  return c.json(data)
})

// Secret-key-protected admin route
app.post('/admin/sync', withSupabase({ auth: 'secret' }), async (c) => {
  const { supabaseAdmin } = c.var.supabaseContext
  const { data } = await supabaseAdmin
    .from('audit_log')
    .insert({ action: 'sync' })
  return c.json(data)
})

// Dual auth — users or services
app.get('/reports', withSupabase({ auth: ['user', 'secret'] }), async (c) => {
  const { supabase, authMode } = c.var.supabaseContext
  return c.json({ authMode })
})

export default { fetch: app.fetch }
```

## Skip behavior

If a previous middleware already set `c.var.supabaseContext`, subsequent `withSupabase` calls skip auth. This matters when multiple `app.use` middlewares overlap on the same path — the first one to set the context wins.

**Important:** Hono runs middleware in registration order (`app.use` before route-level middleware). An `app.use('*', ...)` middleware will always run before inline route middleware, so the skip-if-set pattern cannot be used to make a route stricter than the app-wide default.

For routes that need different auth than the rest of the app, use per-route middleware without an app-wide middleware (see the "Per-route auth" section above).

## CORS

The Hono adapter does not handle CORS — the `cors` option is excluded from its config type. Use Hono's built-in CORS middleware:

```ts
import { Hono } from 'hono'
import { cors } from 'hono/cors'
import { withSupabase } from '@supabase/server/adapters/hono'

const app = new Hono()

app.use('*', cors())
app.use('*', withSupabase({ auth: 'user' }))

app.get('/todos', async (c) => {
  const { supabase } = c.var.supabaseContext
  const { data } = await supabase.from('todos').select()
  return c.json(data)
})

export default { fetch: app.fetch }
```

## Error handling

When auth fails, the adapter throws a Hono `HTTPException`. The original `AuthError` is available via `cause`:

```ts
import { Hono } from 'hono'
import { HTTPException } from 'hono/http-exception'
import { withSupabase } from '@supabase/server/adapters/hono'
import { AuthError } from '@supabase/server'

const app = new Hono()

app.use('*', withSupabase({ auth: 'user' }))

// Custom error handler
app.onError((err, c) => {
  if (err instanceof HTTPException && err.cause instanceof AuthError) {
    const authError = err.cause
    return c.json(
      { error: authError.message, code: authError.code },
      authError.status as 401 | 500,
    )
  }
  return c.json({ error: 'Internal server error' }, 500)
})

app.get('/todos', async (c) => {
  const { supabase } = c.var.supabaseContext
  const { data } = await supabase.from('todos').select()
  return c.json(data)
})

export default { fetch: app.fetch }
```

## Environment overrides

Pass `env` to override auto-detected environment variables, same as the main wrapper:

```ts
app.use(
  '*',
  withSupabase({
    auth: 'user',
    env: { url: 'http://localhost:54321' },
  }),
)
```

## Supabase client options

Forward options to the underlying `createClient()` calls:

```ts
app.use(
  '*',
  withSupabase({
    auth: 'user',
    supabaseOptions: { db: { schema: 'api' } },
  }),
)
```
