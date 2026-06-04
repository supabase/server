# TanStack Start Adapter

The adapter exposes `withSupabase` as a TanStack Start **function middleware**. Attach it to a server function and the `SupabaseContext` is available (and typed) as `context.supabaseContext` in the handler.

It is framework-agnostic: it imports from `@tanstack/start-client-core` and `@tanstack/start-server-core`, which every `@tanstack/{react,solid,vue}-start` package re-exports. So the same adapter works for React, Solid, and Vue Start.

## Setup

You don't install the core packages directly; they come in with your framework's Start package, which you already have:

```bash
pnpm add @tanstack/react-start   # or @tanstack/solid-start, @tanstack/vue-start
```

## Basic server function with auth

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

## Per-function auth

Because middleware is attached per server function, different functions can require different auth modes: just give each its own `withSupabase(...)`:

```ts
import { createServerFn } from '@tanstack/react-start'
import { withSupabase } from '@supabase/server/adapters/tanstack-start'

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

> **Mixed auth modes:** attach `withSupabase` **per function** as shown above rather than registering it as global `functionMiddleware`. Global function middleware runs before per-function middleware, so an app-wide `withSupabase({ auth: 'user' })` would reject a request that only carries a secret key before the function's own stricter/looser middleware ever runs. Register globally only when every server function shares one auth mode.

## Error handling

When auth fails, the middleware throws the package's `AuthError`, which carries an HTTP `status` (`401` for invalid credentials, `500` for server-side auth failures) and a machine-readable `code`.

The most robust place to handle it is **server-side** (a route's `beforeLoad` or loader), where the thrown value is reliably an `AuthError` instance:

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

The adapter does not handle CORS: the `cors` option is excluded from its config type. TanStack Start server functions are same-origin RPC calls; if you expose server routes that need CORS, set the headers in those route handlers.
