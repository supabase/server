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

```ts
import { withSupabase } from '@supabase/server'
import type { Database } from './database.types.ts'

export default {
  fetch: withSupabase<Database>({ auth: 'user' }, async (_req, ctx) => {
    // ctx.supabase is SupabaseClient<Database>
    // Fully typed: column names, return type, etc.
    const { data } = await ctx.supabase
      .from('todos')
      .select('id, title, completed')
    // data is { id: number; title: string; completed: boolean }[] | null
    return Response.json(data)
  }),
}
```

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

## Using with a framework bridge

A [framework bridge](https://supabase.com/docs/reference/server/frameworks) is
one file you copy into your project, and it keeps whatever types the entries
give it. Pass `Database` to `withSupabaseClient<Database>()` and the `supabase`
your handler reads is a `SupabaseClient<Database>`.

In Hono, keep the calls chained and `c.var` types itself, with no `Env`
declaration of your own. Split them — `app.use(...)` on one line and
`app.get(...)` on the next — and the middleware still typechecks, but `c.var`
goes untyped.

```ts
import { Hono } from 'hono'
import { withRequiredClaims } from '@supabase/server/middleware/required-claims'
import { withSupabaseClient } from '@supabase/server/middleware/client'
import type { Database } from './database.types.ts'

import { toHono } from './lib/supabase-middleware.js'

const app = new Hono()
  .use('*', toHono([withRequiredClaims(), withSupabaseClient<Database>()]))
  .get('/todos', async (c) => {
    const { data } = await c.var.supabase.from('todos').select('id, title')
    return c.json(data)
  })
```

Elysia works the same way through its own bridge pair. Pass the same tuple
type to `supabaseCtx` that `wrapElysia` receives, and `c.supabase` is a fully
typed `SupabaseClient<Database>` in every handler.

```ts
import { Elysia } from 'elysia'
import { withRequiredClaims } from '@supabase/server/middleware/required-claims'
import { withSupabaseClient } from '@supabase/server/middleware/client'
import type { Database } from './database.types.ts'

import { supabaseCtx, wrapElysia } from './lib/supabase-middleware.js'

const entries = [withRequiredClaims(), withSupabaseClient<Database>()] as const

const app = new Elysia()
  .use(supabaseCtx<typeof entries>())
  .get('/todos', async (c) => {
    const { data } = await c.supabase.from('todos').select('id, title')
    return data
  })

export default { fetch: wrapElysia(entries, (req) => app.handle(req)) }
```

Frameworks whose per-request store is not generic, such as H3 and NestJS, read
the contributions through `Contributions<typeof entries>` instead. The patterns
are in the frameworks guide, under
[H3](https://supabase.com/docs/reference/server/frameworks#h3) and
[NestJS](https://supabase.com/docs/reference/server/frameworks#nestjs).

## Custom schema

If your tables are in a schema other than `public`, pass it via `supabaseOptions`:

```ts
import { withSupabase } from '@supabase/server'
import type { Database } from './database.types.ts'

export default {
  fetch: withSupabase<Database>(
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
withSupabase<Database>(
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
