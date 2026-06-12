# TanStack Start Adapter

The adapter exposes `withSupabase` as a TanStack Start **request middleware**. Because request middleware runs on every server request, the same middleware works for both server functions and server routes; in either, the `SupabaseContext` is available (and typed) as `context.supabaseContext` in the handler.

It is framework-agnostic: it imports from `@tanstack/start-client-core`, which every `@tanstack/{react,solid,vue}-start` package re-exports. So the same adapter works for React, Solid, and Vue Start.

## Setup

You don't install the core package directly; it comes in with your framework's Start package, which you already have:

```bash
pnpm add @tanstack/react-start   # or @tanstack/solid-start, @tanstack/vue-start
```

## Server function

```ts
import { createServerFn } from '@tanstack/react-start'
import { withSupabase } from '@supabase/server/adapters/tanstack-start'

export const getTodos = createServerFn()
  .middleware([withSupabase({ auth: 'user' })])
  .handler(async ({ context }) => {
    const { data } = await context.supabaseContext.supabase
      .from('todos')
      .select()
    return data
  })
```

The context is available as `context.supabaseContext` and contains the same `SupabaseContext` fields as the main `withSupabase` wrapper: `supabase`, `supabaseAdmin`, `userClaims`, `jwtClaims`, and `authMode`.

## Server route

The same middleware attaches to a server route's `server.middleware`:

```ts
import { createFileRoute } from '@tanstack/react-router'
import { withSupabase } from '@supabase/server/adapters/tanstack-start'

export const Route = createFileRoute('/api/todos')({
  server: {
    middleware: [withSupabase({ auth: 'user' })],
    handlers: {
      GET: async ({ context }) => {
        const { data } = await context.supabaseContext.supabase
          .from('todos')
          .select()
        return Response.json(data)
      },
    },
  },
})
```

## Per-route auth

Because middleware is attached per server function or per route, each one can require a different auth mode: just give it its own `withSupabase(...)`.

```ts
// User-authenticated
export const listTodos = createServerFn()
  .middleware([withSupabase({ auth: 'user' })])
  .handler(async ({ context }) => {
    const { data } = await context.supabaseContext.supabase
      .from('todos')
      .select()
    return data
  })

// Secret-key-protected (e.g. a trusted server-to-server call)
export const syncAuditLog = createServerFn({ method: 'POST' })
  .middleware([withSupabase({ auth: 'secret' })])
  .handler(async ({ context }) => {
    const { data } = await context.supabaseContext.supabaseAdmin
      .from('audit_log')
      .insert({ action: 'sync' })
    return data
  })
```

## Skip behavior

If a previous middleware already resolved `context.supabaseContext`, subsequent `withSupabase` calls skip auth and preserve the established context. The first middleware to run wins, matching the Hono and H3 adapters.

Request middleware runs outer-to-inner: a globally registered `withSupabase` (via `createStart`'s `requestMiddleware`) runs before a per-function or per-route one. So if you need different auth modes for different routes, attach `withSupabase` per route rather than globally; reserve global registration for when every request shares one auth mode.

## Error handling

When auth fails, the middleware throws the package's `AuthError`, which carries an HTTP `status` (`401` for invalid credentials, `500` for server-side auth failures) and a machine-readable `code`. The handler only runs on successful auth.

The most robust place to handle it is server-side (a route's `beforeLoad` or loader), where the thrown value is reliably an `AuthError` instance:

```ts
import { createFileRoute, redirect } from '@tanstack/react-router'
import { AuthError } from '@supabase/server'
import { getTodos } from './todos.server'

export const Route = createFileRoute('/todos')({
  loader: async () => {
    try {
      return { todos: await getTodos() }
    } catch (error) {
      if (error instanceof AuthError && error.status === 401) {
        throw redirect({ to: '/login' })
      }
      throw error
    }
  },
})
```

> **Client-invoked server functions:** TanStack Start serializes thrown errors across the RPC boundary. When a server function is called from a client component (e.g. via `useServerFn`), the `AuthError` message survives but the prototype and custom fields (`instanceof AuthError`, `.status`, `.code`) may not be reconstructed on the client. Catch the error in a server-side `beforeLoad`/loader, where fidelity is guaranteed, and map it to a `redirect()` or your own response shape there.

## Environment overrides

Pass `env` to override auto-detected environment variables, same as the main wrapper:

```ts
createServerFn()
  .middleware([
    withSupabase({ auth: 'user', env: { url: 'http://localhost:54321' } }),
  ])
  .handler(async ({ context }) => context.supabaseContext.userClaims)
```

## Supabase client options

Forward options to the underlying `createClient()` calls:

```ts
createServerFn()
  .middleware([
    withSupabase({
      auth: 'user',
      supabaseOptions: { db: { schema: 'api' } },
    }),
  ])
  .handler(async ({ context }) => {
    const { data } = await context.supabaseContext.supabase
      .from('todos')
      .select()
    return data
  })
```

## CORS

The adapter does not handle CORS: the `cors` option is excluded from its config type. Set any required CORS headers in your server route handlers (server functions are same-origin RPC calls and don't need it).
