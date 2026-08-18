# Postgres (`ctx.postgres`)

Two middleware give you a direct Postgres connection, mirroring the `ctx.supabase` / `ctx.supabaseAdmin` pair:

| Middleware                | Subpath                       | Contributes         | RLS                            |
| ------------------------- | ----------------------------- | ------------------- | ------------------------------ |
| `withPostgresClient`      | `./middleware/postgres`       | `ctx.postgres`      | Enforced, scoped to the caller |
| `withPostgresAdminClient` | `./middleware/postgres-admin` | `ctx.postgresAdmin` | **Bypassed**                   |

Reach for the scoped one by default. The admin one is a deliberate opt-out, covered [below](#bypassing-rls).

`withPostgresClient` puts a direct Postgres connection on `ctx.postgres`, scoped to the calling user by RLS. It is the safe version of "authenticate, then query as the user": you write plain SQL, and Postgres — not your application code — decides which rows the caller may see.

```ts
import { withSupabase } from '@supabase/server'
import { withPostgresClient } from '@supabase/server/middleware/postgres'

export default {
  fetch: withSupabase(
    { auth: 'user', middleware: [withPostgresClient()] },
    async (_req, ctx) => {
      // No WHERE clause — RLS scopes the rows to the caller.
      const notes = await ctx.postgres.query('select id, body from notes')
      return Response.json(notes)
    },
  ),
}
```

Use this when PostgREST is not the right tool: multi-table joins, window functions, CTEs, `insert ... returning` with computed columns, or any query that is simply easier to express in SQL. For ordinary CRUD, `ctx.supabase` is still the better choice.

## What each query runs

Every `ctx.postgres.query()` call takes a connection from the pool and runs your SQL inside its own transaction, injecting the caller's claims exactly the way PostgREST does:

```sql
begin;
select set_config('request.jwt.claims', $claims, true);  -- auth.uid() resolves
set local role authenticated;                            -- RLS now enforces
-- your query
commit;
```

Both `set_config`'s third argument and `set local` are transaction-local, so nothing leaks onto the pooled connection when it goes back to the pool.

The role is **clamped** to `authenticated` or `anon`. A token claiming `role: "service_role"` still runs as `anon` — a caller can never talk their way into an RLS-bypassing role. For deliberate service-role access, use a separate admin path.

### Write policies with the `auth.*` helpers

The single `request.jwt.claims` setting is the whole claim payload as JSON, and it is the only one this middleware sets. `auth.uid()`, `auth.role()`, and `auth.jwt()` all read it, so policies written the normal way work unchanged:

```sql
create policy "users read their own notes"
  on public.notes for select to authenticated
  using ((select auth.uid()) = user_id);
```

Reach for those helpers rather than reading settings by hand. In particular, the older singular GUCs — `current_setting('request.jwt.claim.sub')` and friends — are **not** set here; they are a legacy PostgREST convention that PostgREST itself has since removed. A policy that reads them directly sees `NULL` and quietly matches nothing.

## Composition

`withPostgresClient` needs the caller's verified claims at `ctx.jwtClaims`. That prerequisite is enforced at compile time, so there are exactly two ways to satisfy it.

**Inside `withSupabase`** — the context already carries `jwtClaims`, so compose it directly:

```ts
withSupabase({ auth: 'user', middleware: [withPostgresClient()] }, handler)
```

**Standalone** — in a Supabase-agnostic `pipeline`, pair it with [`withClaims`](../src/middleware/claims/index.ts), which verifies the Bearer token against the project JWKS:

```ts
import { pipeline } from '@supabase/middleware'
import { withClaims } from '@supabase/server/middleware/claims'
import { withPostgresClient } from '@supabase/server/middleware/postgres'

export default {
  fetch: pipeline([withClaims(), withPostgresClient()], async (_req, ctx) => {
    const rows = await ctx.postgres.query('select id, title from posts')
    return Response.json({ rows, caller: ctx.jwtClaims?.sub ?? 'anon' })
  }),
}
```

Order matters. `withPostgresClient` before `withClaims` is a compile-time error:

```
middleware-prereq: key 'jwtClaims' is not yet on the context (check ordering)
```

## Table grants

Queries run as `authenticated` or `anon`, and on current Supabase projects new tables grant those roles nothing. RLS policies are not enough on their own — a policy filters rows the role is already allowed to touch.

```sql
grant select, insert on public.notes to authenticated;
```

Without the grant the query fails with `permission denied` (SQLSTATE `42501`) _before_ RLS is consulted. `withPostgresClient` recognizes that code and appends the role and the missing-grant hint to the error message, so the fix is in the error you actually see.

## Bypassing RLS

When a handler legitimately needs to cross user boundaries — an admin dashboard, a cron aggregate, a background job — compose `withPostgresAdminClient` instead. It contributes `ctx.postgresAdmin`, which runs queries as-is under the connection-string role: no claim injection, no role switch, no wrapping transaction.

```ts
import { withSupabase } from '@supabase/server'
import { withPostgresAdminClient } from '@supabase/server/middleware/postgres-admin'

export default {
  fetch: withSupabase(
    { auth: 'secret', middleware: [withPostgresAdminClient()] },
    async (_req, ctx) => {
      const rows = await ctx.postgresAdmin.query(
        'select user_id, count(*) from notes group by user_id',
      )
      return Response.json(rows)
    },
  ),
}
```

Unlike the scoped half it declares **no upstream prerequisite** — it never reads `ctx.jwtClaims`, so it works under `auth: 'secret'` and `auth: 'none'` where there is no caller identity at all.

Compose both when a handler needs each in turn. They share one pool, and `ctx.postgres` stays RLS-scoped regardless:

```ts
middleware: [withPostgresClient(), withPostgresAdminClient()]
```

Two things worth being deliberate about:

- **Authorization becomes yours.** RLS is not consulted, so any per-user scoping has to be a `where` clause you write. The failure mode is silent — a forgotten clause returns every row rather than raising an error.
- **The split is the safety feature.** These are two middleware rather than one object with an `.admin` property so that bypassing RLS is visible at the composition site. You can grep a codebase for `withPostgresAdminClient` and find every handler that can cross user boundaries.

## Configuration

Both middleware take the same option:

```ts
withPostgresClient({ connectionString: 'postgresql://...' })
withPostgresAdminClient({ connectionString: 'postgresql://...' })
```

`connectionString` defaults to the `SUPABASE_DB_URL` environment variable, which Supabase Edge Functions provide automatically. If neither is set the middleware short-circuits with a 500 and `{ message, code: 'ENV_ERROR' }`.

Connections are pooled per process, lazily, one pool per connection string (max 4 connections). The pool outlives individual requests — that is what makes this viable on a per-request runtime.

Both middleware share that cache, so composing the pair opens one pool, not two. Sharing is safe because everything the scoped half sets is transaction-local: a connection always returns to the pool clean, and an admin query can never inherit a previous caller's claims or role.

## Runtime support

`pg` opens a raw TCP socket, so both middleware run on **Node, Deno, Bun, and the Supabase Edge runtime** — but **not** on Workers-style isolates, which have no TCP. On those, use `ctx.supabase`, which talks HTTP to PostgREST.

`pg` is an optional peer dependency. Install it alongside the package when you use this middleware:

```sh
npm install pg
```

## Limits in this version

- **One transaction per `query()` call.** There is no multi-statement transaction API, so you cannot yet span several `query()` calls in one atomic unit. Put multi-statement logic in a database function and call it in a single query.
- **No read-replica routing** and **no trace propagation** — both are tracked separately.
- **No composing wrapper.** There is no `withPostgres()` that gives you both clients at once; list the two entries you want. The name is reserved in case that changes.

## See also

- [`docs/api-reference.md`](api-reference.md) — `withPostgresClient`, `withPostgresAdminClient`, `PostgresApi`, config types
- [`docs/security.md`](security.md) — how RLS fits the rest of the auth model
