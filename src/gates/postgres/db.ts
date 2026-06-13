/**
 * Postgres client helpers for the {@link withPostgres} gate — the RLS-scoped
 * `db` client and the RLS-bypassing `adminDb` client it can contribute.
 *
 * The `pg` import lives here and nowhere else in the package — keep it that way
 * so importing the package root (or any edge-targeted subpath) never pulls
 * node-postgres into a Workers/edge bundle. This module runs only on Node/Deno
 * server runtimes.
 *
 * Every operation owns its connection lifecycle: each {@link Db.query} runs in
 * its own short transaction, and {@link Db.tx} wraps a multi-statement block in
 * one. By the time a returned promise settles, the connection is already back
 * in the pool — there is no connection held across the request handler, so the
 * gate needs no after-handler cleanup hook.
 */

import { Pool, type PoolClient, type QueryResult } from 'pg'

/**
 * A minimal Postgres surface contributed at `ctx.postgres.db` /
 * `ctx.postgres.adminDb`.
 *
 * - `query` — run a single statement. For the user client this is its own
 *   auth-scoped transaction; for the admin client it runs straight on the pool.
 * - `tx` — run a multi-statement block atomically in one transaction. Throwing
 *   inside `fn` rolls the whole block back.
 */
export interface Db {
  /** Run a single parameterized statement and resolve its {@link QueryResult}. */
  query: (text: string, params?: unknown[]) => Promise<QueryResult>

  /** Run `fn` against a dedicated client inside one transaction, atomically. */
  tx: <T>(fn: (client: PoolClient) => Promise<T>) => Promise<T>
}

/** Connection roles the user client may run as. Never `service_role`. */
export type Role = 'authenticated' | 'anon'

/** RFC 7519 claims subset the auth-scoped transaction injects into Postgres. */
export type Claims = { sub?: string; role?: string; [k: string]: unknown }

let defaultPool: Pool | undefined

/** Read `SUPABASE_DB_URL` across Deno / Node / Bun, mirroring `resolveEnv`. */
function dbUrl(): string | undefined {
  if (typeof Deno !== 'undefined' && Deno.env?.get) {
    return Deno.env.get('SUPABASE_DB_URL')
  }
  if (typeof process !== 'undefined' && process.env) {
    return process.env.SUPABASE_DB_URL
  }
  return undefined
}

/**
 * Resolve the pool to use: an explicit `override`, or a lazily-created module
 * default backed by `SUPABASE_DB_URL`. The default is created once and reused
 * across requests.
 */
export function getPool(override?: Pool): Pool {
  if (override) return override
  defaultPool ??= new Pool({ connectionString: dbUrl() })
  return defaultPool
}

/**
 * PostgREST-style auth-scoped transaction: open a transaction, pin the JWT
 * claims and connection role to it with `set local` (so nothing leaks onto the
 * pooled connection), run `fn`, then commit and release.
 *
 * Self-contained — by the time the returned promise settles, the connection is
 * already back in the pool. No after-handler cleanup required.
 */
async function inAuthedTx<T>(
  pool: Pool,
  claims: Claims,
  role: Role,
  fn: (client: PoolClient) => Promise<T>,
): Promise<T> {
  const client = await pool.connect()
  try {
    await client.query('begin')
    await client.query(`select set_config('request.jwt.claims', $1, true)`, [
      JSON.stringify(claims),
    ])
    await client.query(`set local role ${role}`)
    const out = await fn(client)
    await client.query('commit')
    return out
  } catch (e) {
    await client.query('rollback')
    throw e
  } finally {
    client.release()
  }
}

/**
 * User client: each `query()` is its own auth-scoped transaction; `tx()` runs a
 * multi-statement block atomically in one auth-scoped transaction. Both apply
 * the caller's `claims` and `role`, so RLS policies see the authenticated user.
 */
export function authedDb(pool: Pool, claims: Claims, role: Role): Db {
  return {
    query: (text, params) =>
      inAuthedTx(pool, claims, role, (c) => c.query(text, params)),
    tx: (fn) => inAuthedTx(pool, claims, role, fn),
  }
}

/**
 * Admin client: bypasses RLS by staying as the connection role (no `set role`,
 * no claims). `query()` runs straight on the pool; `tx()` is a plain
 * begin/commit block.
 */
export function adminDb(pool: Pool): Db {
  return {
    query: (text, params) => pool.query(text, params),
    async tx(fn) {
      const client = await pool.connect()
      try {
        await client.query('begin')
        const out = await fn(client)
        await client.query('commit')
        return out
      } catch (e) {
        await client.query('rollback')
        throw e
      } finally {
        client.release()
      }
    },
  }
}
