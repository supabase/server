# TypeScript Generics

## Overview

All client-creating functions accept a `Database` generic parameter. When you pass your generated database types, every `.from('table').select()` call is fully typed — column names, return types, insert shapes, and RPC signatures.

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

## Using with the Hono adapter

The Hono context variable is typed as `SupabaseContext` (without the generic). To get typed clients, assert the type when destructuring:

```ts
import { Hono } from 'hono'
import { withSupabase } from '@supabase/server/adapters/hono'
import type { SupabaseContext } from '@supabase/server'
import type { Database } from './database.types.ts'

const app = new Hono()

app.use('*', withSupabase({ auth: 'user' }))

app.get('/todos', async (c) => {
  const { supabase } = c.var.supabaseContext as SupabaseContext<Database>
  const { data } = await supabase.from('todos').select('id, title')
  return c.json(data)
})
```

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
