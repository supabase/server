/**
 * Integration tests for the postgres gates. These need a REAL Postgres — RLS,
 * roles, and `set local role` can't be faked by an in-memory shim — so the
 * whole suite self-skips unless `SUPABASE_DB_URL` is set. Point it at a local
 * Supabase stack (`supabase start`) or any Postgres where the connecting role
 * is a superuser / has `BYPASSRLS` and can `set role authenticated`.
 *
 * `beforeAll` seeds everything the cases assume:
 * - roles `authenticated`, `anon`, `service_role`, granted to the connecting
 *   role so `set local role` works,
 * - `auth.uid()` reading `request.jwt.claims ->> 'sub'`,
 * - table `gate_pg_notes(id, owner uuid default auth.uid(), body)` with RLS on
 *   and policy `owner = auth.uid()`.
 *
 * The `@ts-expect-error` case below is validated by `tsc --noEmit` even in CI,
 * where the runtime cases are skipped.
 */

import { Pool } from 'pg'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import type { JWTClaims } from '../../types.js'

import { withPostgres } from './with-postgres.js'

const DB_URL =
  typeof process !== 'undefined' ? process.env.SUPABASE_DB_URL : undefined

const USER_A = '11111111-1111-1111-1111-111111111111'
const USER_B = '22222222-2222-2222-2222-222222222222'

const SETUP_SQL = `
  create schema if not exists auth;

  create or replace function auth.uid() returns uuid language sql stable as $$
    select nullif(current_setting('request.jwt.claims', true)::jsonb ->> 'sub', '')::uuid
  $$;

  do $$ begin
    if not exists (select from pg_roles where rolname = 'authenticated') then create role authenticated; end if;
    if not exists (select from pg_roles where rolname = 'anon') then create role anon; end if;
    if not exists (select from pg_roles where rolname = 'service_role') then create role service_role; end if;
  end $$;

  grant authenticated, anon, service_role to current_user;

  drop table if exists gate_pg_notes;
  create table gate_pg_notes (
    id uuid primary key default gen_random_uuid(),
    owner uuid not null default auth.uid(),
    body text
  );
  alter table gate_pg_notes enable row level security;
  grant select, insert, update, delete on gate_pg_notes to authenticated, anon;
  create policy gate_pg_notes_owner on gate_pg_notes
    using (owner = auth.uid()) with check (owner = auth.uid());
`

const TEARDOWN_SQL = `drop table if exists gate_pg_notes;`

/** Build a minimal authenticated-user upstream ctx for the gate. */
function authedCtx(sub: string): { jwtClaims: JWTClaims } {
  return { jwtClaims: { sub, role: 'authenticated' } }
}

const req = (): Request => new Request('http://localhost/')

describe.skipIf(!DB_URL)('postgres gates (integration)', () => {
  let pool: Pool

  beforeAll(async () => {
    pool = new Pool({ connectionString: DB_URL })
    await pool.query(SETUP_SQL)
    // Seed as admin (bypasses RLS) with explicit owners: two for A, one for B.
    await pool.query(
      `insert into gate_pg_notes (owner, body) values ($1, 'a1'), ($1, 'a2'), ($2, 'b1')`,
      [USER_A, USER_B],
    )
  })

  afterAll(async () => {
    if (!pool) return
    await pool.query(TEARDOWN_SQL)
    await pool.end()
  })

  it('scopes ctx.postgres.db to the caller — other users rows are invisible', async () => {
    const handler = withPostgres({ pool }, async (_req, ctx) => {
      const r = await ctx.postgres.db.query(
        'select body from gate_pg_notes order by body',
      )
      return Response.json({ bodies: r.rows.map((row) => row.body) })
    })

    const res = await handler(req(), authedCtx(USER_A))
    expect(await res.json()).toEqual({ bodies: ['a1', 'a2'] })
  })

  it('ctx.postgres.db.tx commits a multi-statement block atomically', async () => {
    const handler = withPostgres({ pool }, async (_req, ctx) => {
      await ctx.postgres.db.tx(async (c) => {
        await c.query(`insert into gate_pg_notes (body) values ('tx1')`)
        await c.query(`insert into gate_pg_notes (body) values ('tx2')`)
      })
      const r = await ctx.postgres.db.query(
        `select count(*)::int as n from gate_pg_notes where body in ('tx1', 'tx2')`,
      )
      return Response.json({ n: r.rows[0].n })
    })

    const res = await handler(req(), authedCtx(USER_A))
    expect(await res.json()).toEqual({ n: 2 })
  })

  it('ctx.postgres.db.tx rolls the whole block back when fn throws', async () => {
    const handler = withPostgres({ pool }, async (_req, ctx) => {
      try {
        await ctx.postgres.db.tx(async (c) => {
          await c.query(
            `insert into gate_pg_notes (body) values ('rollback-me')`,
          )
          throw new Error('boom')
        })
      } catch {
        // expected
      }
      const r = await ctx.postgres.db.query(
        `select count(*)::int as n from gate_pg_notes where body = 'rollback-me'`,
      )
      return Response.json({ n: r.rows[0].n })
    })

    const res = await handler(req(), authedCtx(USER_A))
    expect(await res.json()).toEqual({ n: 0 })
  })

  it('ctx.postgres.adminDb bypasses RLS and sees every row when admin: true', async () => {
    const handler = withPostgres({ pool, admin: true }, async (_req, ctx) => {
      const r = await ctx.postgres.adminDb.query(
        `select count(*)::int as n from gate_pg_notes where body in ('a1', 'a2', 'b1')`,
      )
      return Response.json({ n: r.rows[0].n })
    })

    const res = await handler(req(), { jwtClaims: null })
    expect(await res.json()).toEqual({ n: 3 })
  })

  it('null jwtClaims runs as anon — owner-scoped policy yields no rows', async () => {
    const handler = withPostgres({ pool }, async (_req, ctx) => {
      const r = await ctx.postgres.db.query(
        'select count(*)::int as n from gate_pg_notes',
      )
      return Response.json({ n: r.rows[0].n })
    })

    const res = await handler(req(), { jwtClaims: null })
    expect(await res.json()).toEqual({ n: 0 })
  })

  it('does not leak connections — pool returns to baseline after N requests', async () => {
    const handler = withPostgres({ pool }, async (_req, ctx) => {
      await ctx.postgres.db.query('select 1')
      return Response.json({ ok: true })
    })

    for (let i = 0; i < 10; i++) {
      await handler(req(), authedCtx(USER_A))
    }

    // Every checked-out client has been released back to the pool, none left
    // mid-transaction.
    expect(pool.idleCount).toBe(pool.totalCount)
    expect(pool.waitingCount).toBe(0)
  })

  it('rejects composing withPostgres without an upstream jwtClaims (compile-fail)', () => {
    const handler = withPostgres({ pool }, async (_req, ctx) => {
      void ctx.postgres.db
      return Response.json({ ok: true })
    })
    // `withPostgres` declares `In = { jwtClaims }`, so `baseCtx` is required —
    // invoking without it is a type error. Type-checked but never executed, so
    // it can't trip a runtime rejection.
    const compileFail = (): unknown =>
      // @ts-expect-error — missing required baseCtx providing jwtClaims
      handler(req())
    void compileFail
  })

  it('rejects ctx.postgres.adminDb without admin: true (compile-fail)', () => {
    void withPostgres({ pool }, async (_req, ctx) => {
      // Without `admin: true`, the contribution narrows to `{ db }` only —
      // reaching for `adminDb` is a type error. Type-checked, never executed.
      // @ts-expect-error — adminDb only exists when configured with admin: true
      void ctx.postgres.adminDb
      return Response.json({ ok: true })
    })
  })
})
