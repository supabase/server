# `@supabase/server/gates/postgres`

Direct Postgres access from a handler, with Supabase's auth model intact. Two gates:

- **`withPostgres`** — contributes `ctx.postgres`, an **RLS-scoped** client. Every
  operation runs as the caller's JWT (claims + connection role pinned to a single
  transaction, PostgREST-style), so `auth.uid()` and your RLS policies behave exactly
  as they do through PostgREST.
- **`withPostgresAdmin`** — contributes `ctx.postgresAdmin`, an **RLS-bypassing**
  client for trusted server-side work that must see every row.

> **Node/Deno only.** These gates use [`pg`](https://node-postgres.com) and do **not**
> run on Cloudflare Workers / edge runtimes. The `pg` import is confined to this
> subpath, so importing the package root (or any other subpath) stays edge-safe — only
> `@supabase/server/gates/postgres` pulls in node-postgres.

```ts
import { withSupabase } from '@supabase/server'
import {
  withPostgres,
  withPostgresAdmin,
} from '@supabase/server/gates/postgres'

export default {
  fetch: withSupabase(
    { auth: 'user' }, // ctx.supabase, ctx.jwtClaims
    withPostgres(
      {}, // ctx.postgres      — RLS as the user
      withPostgresAdmin(
        {}, // ctx.postgresAdmin — bypasses RLS
        async (_req, ctx) => {
          // auth.uid() = ctx.jwtClaims.sub
          const mine = await ctx.postgres.query('select * from notes')
          const all = await ctx.postgresAdmin.query(
            'select count(*) from notes',
          )

          // Multi-statement atomicity when you want it:
          await ctx.postgres.tx(async (c) => {
            await c.query('insert into notes(body) values ($1)', ['a'])
            await c.query('insert into notes(body) values ($1)', ['b'])
          })

          return Response.json({ mine: mine.rows, total: all.rows[0].count })
        },
      ),
    ),
  ),
}
```

`withPostgres` declares `jwtClaims` as a prerequisite, so composing it **outside**
`withSupabase` (or any wrapper that provides `jwtClaims`) is a compile-time type error.
`withPostgresAdmin` has no prerequisites and can be used standalone.

## Config

Both gates take the same single optional field:

| Field  | Type    | Description                                                                                                                                              |
| ------ | ------- | -------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `pool` | `Pool?` | A `pg` `Pool` to draw connections from. When omitted, a lazily-created module-level pool backed by `SUPABASE_DB_URL` is used and shared across requests. |

## `query` vs `tx`

`ctx.postgres` / `ctx.postgresAdmin` each expose two methods:

- **`query(text, params?)`** — run a single statement. For the user client, each call
  is its **own** auth-scoped transaction; for the admin client it runs straight on the
  pool.
- **`tx(fn)`** — run a multi-statement block **atomically** in one transaction. The
  whole block commits together, and throwing anywhere inside `fn` rolls all of it back.

There is **no** implicit request-wide transaction. Two separate `query()` calls are two
separate transactions — reach for `tx()` whenever statements must succeed or fail as a
unit.

```ts
// One auth-scoped transaction; both inserts commit or neither does.
await ctx.postgres.tx(async (c) => {
  const { rows } = await c.query(
    'insert into orders(total) values ($1) returning id',
    [99],
  )
  await c.query('insert into order_items(order_id, sku) values ($1, $2)', [
    rows[0].id,
    'ABC',
  ])
})
```

## Role clamp

`withPostgres` derives the user client's Postgres **connection role** from the JWT, but
**clamps** it: `authenticated` only when `jwtClaims.role === 'authenticated'`, otherwise
`anon`. A token claim can never flip the user client into `service_role` or any other
RLS-bypassing role — bypassing RLS is exclusively `withPostgresAdmin`'s job. A `null`
`jwtClaims` (non-user auth modes) runs as `anon`.

## Pooling

Every operation is a **self-contained short transaction**: open, `set local` the claims
and role, do the work, commit, release. Nothing is held across the handler and no
session-level (`is_local = false`) state is ever set on a pooled connection. That makes
these gates safe through:

- **Supavisor transaction mode** (port `6543`),
- **Supavisor session mode**,
- a **direct** connection.

Point `SUPABASE_DB_URL` (or a `pool` you pass in) at whichever fits your deployment.

## Testing

The integration suite ([`index.test.ts`](./index.test.ts)) needs a real Postgres and
self-skips unless `SUPABASE_DB_URL` is set. To run it locally:

```sh
SUPABASE_DB_URL='postgres://postgres:postgres@127.0.0.1:5432/postgres' pnpm test
```

The suite seeds its own roles, `auth.uid()`, and an RLS-protected table — point it at a
throwaway database (a local `supabase start` stack or a disposable Postgres container).
