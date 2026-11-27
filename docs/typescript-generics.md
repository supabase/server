# TypeScript Generics

## Overview

All client-creating functions accept a `Database` generic parameter. When you pass your generated database types, every `.from('table').select()` call is fully typed — column names, return types, insert shapes, and RPC signatures.

Without one, `Database` defaults to `any` — the same default `createClient()` uses in `@supabase/supabase-js` — so `.from()`, `.select()`, `.insert()`, and `.update()` all type-check without a generated schema.

## Generating types

Use the Supabase CLI to generate TypeScript types from your database schema:

```bash
npx supabase gen types typescript --project-id your-project-ref > src/database.types.ts
```

This produces a `Database` type that describes your schema.

## Using with withSupabase

Choose `Database` once with `createWithSupabase`, at module scope, and use the result wherever you'd use `withSupabase`:

```ts
import { createWithSupabase } from '@supabase/server'
import type { Database } from './database.types.ts'

const withSupabase = createWithSupabase<Database>()

export default {
  fetch: withSupabase({ auth: 'user' }, async (_req, ctx) => {
    // ctx.supabase and ctx.supabaseAdmin are SupabaseClient<Database>
    // Fully typed: column names, return type, etc.
    const { data } = await ctx.supabase
      .from('todos')
      .select('id, title, completed')
    // data is { id: number; title: string; completed: boolean }[] | null
    return Response.json(data)
  }),
}
```

The result composes the same way `withSupabase` does: nested around a handler or another middleware, or as a `pipeline` entry, where the entries after it see the typed clients.

```ts
import { pipeline } from '@supabase/middleware'
import { withPostgresClient } from '@supabase/server/middleware/postgres'

export default {
  fetch: pipeline(
    [withSupabase({ auth: 'user' }), withPostgresClient()],
    async (_req, ctx) => {
      // ctx.supabase is SupabaseClient<Database>; ctx.postgres is RLS-scoped too
      const { data } = await ctx.supabase.from('todos').select('id, title')
      return Response.json(data)
    },
  ),
}
```

`createWithSupabase` returns a `Composite` from `@supabase/middleware`, so the engine checks it like any composite. A middleware below it that contributes one of its keys fails to compile: `withClaims()` contributes `jwtClaims`, which it already provides. In a nested stack, the check needs `satisfies FetchHandler` on the outermost call.

Passing `Database` to `withSupabase` itself (`withSupabase<Database>(config, handler)`) is deprecated. It also fixes `withSupabase`'s second type parameter to its default, so keys from a middleware wrapped around it are missing from `ctx`.

## Using with createSupabaseContext

```ts
import { createSupabaseContext } from '@supabase/server'
import type { Database } from './database.types.ts'

const { data: ctx, error } = await createSupabaseContext<Database>(request, {
  auth: 'user',
})

if (error) {
  throw error
}

// ctx.supabase and ctx.supabaseAdmin are both SupabaseClient<Database>
const { data } = await ctx!.supabase.from('profiles').select('id, email')
```

## Using with core primitives

```ts
import {
  verifyAuth,
  createContextClient,
  createAdminClient,
} from '@supabase/server/core'
import type { Database } from './database.types.ts'

const { data: auth } = await verifyAuth(request, { auth: 'user' })

const supabase = createContextClient<Database>({
  auth: { token: auth!.token },
})

const supabaseAdmin = createAdminClient<Database>()

// Both clients are fully typed
const { data: todos } = await supabase.from('todos').select()
const { data: users } = await supabaseAdmin.from('profiles').select()
```

## Using with the Hono adapter

Pass an app environment type to `Hono<Env>()` so Hono knows the `supabaseContext` variable includes your generated database types:

```ts
import { Hono } from 'hono'
import { withSupabase } from '@supabase/server/adapters/hono'
import type { SupabaseContext } from '@supabase/server'
import type { Database } from './database.types.ts'

type Env = {
  Variables: {
    supabaseContext: SupabaseContext<Database>
  }
}

const app = new Hono<Env>()

app.use('*', withSupabase({ auth: 'user' }))

app.get('/todos', async (c) => {
  const { supabase } = c.var.supabaseContext
  const { data } = await supabase.from('todos').select('id, title')
  return c.json(data)
})
```

Alternatively, skip the `Env` type and thread `Database` through the `withSupabase<Database>()` generic when using chained declarations. Hono infers the `supabaseContext` variable type from the middleware, so `c.var.supabaseContext.supabase` is still a fully typed `SupabaseClient<Database>`. This plays a little nicer with hono [sub-application routes](https://hono.dev/docs/helpers/route#working-with-sub-applications).

```ts
import { Hono } from 'hono'
import { withSupabase } from '@supabase/server/adapters/hono'
import type { Database } from './database.types.ts'

const app = new Hono()

const todosApp = new Hono()
  .use(withSupabase<Database>({ auth: 'user' }))
  .get('/', async (c) => {
    const { supabase } = c.var.supabaseContext
    const { data } = await supabase.from('todos').select('id, title')
    return c.json(data)
  })

app.route('/todos', todosApp)
```

The elysia adapter works the same way: thread `Database` through the `withSupabase<Database>()` generic and elysia infers the `supabaseContext` type, so `supabaseContext.supabase` is a fully typed `SupabaseClient<Database>` in every handler.

```ts
import { Elysia } from 'elysia'
import { withSupabase } from '@supabase/server/adapters/elysia'
import type { Database } from './database.types.ts'

const app = new Elysia()
  .use(withSupabase<Database>({ auth: 'user' }))
  .get('/todos', async ({ supabaseContext }) => {
    const { data } = await supabaseContext.supabase
      .from('todos')
      .select('id, title')
    return data
  })

app.listen(3000)
```

## Custom schema

If your tables are in a schema other than `public`, pass it via `supabaseOptions`:

```ts
import { createWithSupabase } from '@supabase/server'
import type { Database } from './database.types.ts'

const withSupabase = createWithSupabase<Database>()

export default {
  fetch: withSupabase(
    {
      auth: 'user',
      supabaseOptions: { db: { schema: 'api' } },
    },
    async (_req, ctx) => {
      // Queries target the 'api' schema
      const { data } = await ctx.supabase.from('todos').select()
      return Response.json(data)
    },
  ),
}
```

## Forwarding other Supabase client options

`supabaseOptions` accepts the same options as `createClient()` from `@supabase/supabase-js`, with two exceptions:

- `accessToken` is stripped — token injection is managed by the SDK from verified credentials
- Auth settings (`persistSession`, `autoRefreshToken`, `detectSessionInUrl`) are force-set to server-safe values

```ts
withSupabase(
  {
    auth: 'user',
    supabaseOptions: {
      db: { schema: 'api' },
      global: {
        headers: { 'x-custom-header': 'value' },
      },
    },
  },
  handler,
)
```

Note: `Authorization` and `apikey` headers in `supabaseOptions.global.headers` are sanitized (removed) to prevent overriding the verified credentials.
