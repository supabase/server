# Express Adapter

## Setup

Install Express as a peer dependency:

```bash
pnpm add express
pnpm add -D @types/express
```

The adapter exports an Express 5 `RequestHandler` instead of a fetch handler. The resolved `SupabaseContext` is stored on `res.locals.supabaseContext` (typed via declaration merging) so every downstream handler can read it.

> **Express 5 only.** The adapter relies on Express 5's native async-error handling — an `async` middleware that returns a rejected promise propagates to your error pipeline without `express-async-errors` or any other wrapper.

## Basic app with auth

```ts
import express from 'express'
import { withSupabase } from '@supabase/server/adapters/express'

const app = express()

// Apply auth to all routes
app.use(withSupabase({ auth: 'user' }))

app.get('/todos', async (_req, res) => {
  const { supabase } = res.locals.supabaseContext
  const { data } = await supabase.from('todos').select()
  res.json(data)
})

app.get('/profile', async (_req, res) => {
  const { supabase, userClaims } = res.locals.supabaseContext
  const { data } = await supabase
    .from('profiles')
    .select()
    .eq('id', userClaims!.id)
  res.json(data)
})

app.listen(3000)
```

The context is stored in `res.locals.supabaseContext` and contains the same `SupabaseContext` fields as the main `withSupabase` wrapper: `supabase`, `supabaseAdmin`, `userClaims`, `jwtClaims`, `authMode`, and `authKeyName`.

## Per-route auth

Two composition patterns are supported.

### Mount `withSupabase()` once, then guard with `requireAuth()`

When most routes share a baseline auth set, mount the middleware once and use `requireAuth()` per route to narrow the allowed modes. This is the recommended ergonomic pattern.

```ts
import express from 'express'
import { requireAuth, withSupabase } from '@supabase/server/adapters/express'

const app = express()

// App-wide: accept either a user JWT or a secret key
app.use(withSupabase({ auth: ['user', 'secret'] }))

// User-only
app.get('/me', requireAuth('user'), async (_req, res) => {
  const { userClaims } = res.locals.supabaseContext
  res.json(userClaims)
})

// Service-only
app.post('/admin/sync', requireAuth('secret'), async (_req, res) => {
  const { supabaseAdmin } = res.locals.supabaseContext
  const { data } = await supabaseAdmin
    .from('audit_log')
    .insert({ action: 'sync' })
  res.json(data)
})

// Service-only, named key — only the "cron" secret key may call this
app.post('/admin/refresh', requireAuth('secret:cron'), async (_req, res) => {
  const { supabaseAdmin } = res.locals.supabaseContext
  await supabaseAdmin.rpc('refresh_popular')
  res.json({ ok: true })
})

app.listen(3000)
```

`requireAuth(modes?)` reads `res.locals.supabaseContext` set by an upstream `withSupabase()`. If the context is missing or the established `authMode` / `authKeyName` does not match, it forwards an `AuthError` via `next(err)` so your error middleware can render the 401. The `publishable:*` and `secret:*` wildcards accept any named key for that base mode.

### Wrap a single route with `withSupabaseRoute()`

When you do NOT want a global middleware — for example, a single authenticated route in an otherwise public app — wrap the route directly. The handler receives the resolved context as a fourth argument, so you don't need to read `res.locals`.

```ts
import express from 'express'
import { withSupabaseRoute } from '@supabase/server/adapters/express'

const app = express()

// Public, no auth
app.get('/health', (_req, res) => {
  res.json({ status: 'ok' })
})

// Just this route is authenticated
app.get(
  '/todos',
  withSupabaseRoute({ auth: 'user' }, async (_req, res, _next, ctx) => {
    const { data } = await ctx.supabase.from('todos').select()
    res.json(data)
  }),
)

// Different mode on a different route — no global middleware needed
app.post(
  '/admin/sync',
  withSupabaseRoute({ auth: 'secret' }, async (_req, res, _next, ctx) => {
    const { data } = await ctx.supabaseAdmin
      .from('audit_log')
      .insert({ action: 'sync' })
    res.json(data)
  }),
)

app.listen(3000)
```

`withSupabaseRoute()` also populates `res.locals.supabaseContext`, so chaining additional `requireAuth()` guards on the same route still works.

## Skip behavior

If a previous middleware already set `res.locals.supabaseContext`, subsequent `withSupabase` calls skip auth and call `next()` immediately. This lets a route-level middleware override an app-wide default:

```ts
import express from 'express'
import { withSupabase } from '@supabase/server/adapters/express'

const app = express()

// App-wide default: user auth
app.use(withSupabase({ auth: 'user' }))

// This route needs secret auth instead.
// The route-level middleware runs first, sets the context,
// and the app-wide middleware sees res.locals.supabaseContext
// is already populated and skips.
app.post('/webhook', withSupabase({ auth: 'secret' }), async (_req, res) => {
  const { supabaseAdmin } = res.locals.supabaseContext
  await supabaseAdmin.from('webhook_log').insert({})
  res.json({ ok: true })
})

app.listen(3000)
```

`withSupabaseRoute()` is the terminal entry point for its own route and does NOT short-circuit on a pre-existing context — use it when you want the route's auth config to always run.

## Error handling

By default, an `AuthError` from `createSupabaseContext` is forwarded via `next(error)` so your existing Express error middleware handles it — the Express-idiomatic flow:

```ts
import express, { type ErrorRequestHandler } from 'express'
import { AuthError } from '@supabase/server'
import { withSupabase } from '@supabase/server/adapters/express'

const app = express()

app.use(withSupabase({ auth: 'user' }))

app.get('/todos', async (_req, res) => {
  const { supabase } = res.locals.supabaseContext
  const { data } = await supabase.from('todos').select()
  res.json(data)
})

const errorHandler: ErrorRequestHandler = (err, _req, res, next) => {
  if (err instanceof AuthError) {
    res.status(err.status).json({ code: err.code, message: err.message })
    return
  }
  next(err)
}

app.use(errorHandler)

app.listen(3000)
```

The `AuthError` retains its `.status`, `.code`, and `.message` so you can map directly to an HTTP response without re-parsing.

### Inline `onError` handler

Pass an `onError` callback to handle auth failures next to the middleware itself. When provided, the adapter calls it instead of `next(error)` — your handler owns response/next semantics:

```ts
app.use(
  withSupabase({
    auth: 'user',
    onError: (error, _req, res) => {
      res
        .status(error.status)
        .json({ code: error.code, message: error.message })
    },
  }),
)
```

If your `onError` throws or returns a rejected promise, the thrown error is forwarded via `next(err)` so Express's error pipeline still triggers. The same `onError` option is also available on `withSupabaseRoute()`.

## CORS

The Express adapter does not handle CORS — the `cors` option is excluded from its config type. Use the [`cors`](https://www.npmjs.com/package/cors) npm package:

```ts
import cors from 'cors'
import express from 'express'
import { withSupabase } from '@supabase/server/adapters/express'

const app = express()

app.use(cors())
app.use(withSupabase({ auth: 'user' }))

app.get('/todos', async (_req, res) => {
  const { supabase } = res.locals.supabaseContext
  const { data } = await supabase.from('todos').select()
  res.json(data)
})

app.listen(3000)
```

## Request body forwarding

The adapter forwards request bodies for non-`GET`/`HEAD` methods so `createSupabaseContext` can read whatever it needs from the request. It works in two scenarios:

- **No body parser registered** — the raw `IncomingMessage` stream is forwarded directly.
- **A body parser (e.g., `express.json()`) ran** — the parsed `req.body` is re-serialized.

You do not need to register `express.json()` just to make auth work; mount it only if your route handlers consume `req.body`.

## Environment overrides

Pass `env` to override auto-detected environment variables, same as the main wrapper:

```ts
app.use(
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
  withSupabase({
    auth: 'user',
    supabaseOptions: { db: { schema: 'api' } },
  }),
)
```

## Trust proxy

When deploying Express behind a reverse proxy (Vercel, Fly, Heroku, an nginx ingress, etc.), enable `trust proxy` so the adapter composes the correct absolute URL from `X-Forwarded-Proto` and the forwarded host. The adapter reads `req.protocol`, which already honors this setting:

```ts
app.set('trust proxy', true)
app.use(withSupabase({ auth: 'user' }))
```

## TypeScript

`res.locals.supabaseContext` is typed via Express's declaration-merged `Express.Locals` namespace, so it's available on every `Response` after the middleware has run:

```ts
import type { Request, Response } from 'express'

function handler(_req: Request, res: Response) {
  const { supabase, authMode } = res.locals.supabaseContext // fully typed
  // ...
}
```

If you need to extend the adapter's config (e.g., wrap it in your own factory), import the `WithSupabaseExpressConfig` and `ExpressAuthErrorHandler` types:

```ts
import type {
  ExpressAuthErrorHandler,
  WithSupabaseExpressConfig,
} from '@supabase/server/adapters/express'
```
