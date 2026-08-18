import { getEnv } from '@supabase/middleware'
import pg from 'pg'

import { EnvGenericError } from '../errors.js'

const { Pool } = pg

/**
 * The shape of `ctx.postgres` and `ctx.postgresAdmin`.
 *
 * Both halves expose the same surface — they differ in what runs around the
 * query, not in how you call it. `withPostgresClient` wraps every query in a
 * transaction that injects the caller's claims and drops to their role;
 * `withPostgresAdminClient` runs it as-is, as the connection-string role.
 *
 * @category Middleware
 */
export interface PostgresApi {
  /** Run a query and return its rows. */
  query<T = Record<string, unknown>>(
    text: string,
    params?: unknown[],
  ): Promise<T[]>
}

// One pool per connection string per process, lazily created. Keyed rather than
// a bare singleton so two handlers pointed at different databases in the same
// process don't share one pool.
//
// The scoped and admin middleware deliberately share this cache: they use the
// same connection string, and the only difference is whether the transaction
// preamble runs. Both `set_config(..., true)` and `SET LOCAL` are
// transaction-local, so a connection always returns to the pool clean — an
// admin query can never inherit a previous caller's claims or role.
const pools = new Map<string, pg.Pool>()

/** @internal */
export function getPool(connectionString: string): pg.Pool {
  let pool = pools.get(connectionString)
  if (!pool) {
    pool = new Pool({ connectionString, max: 4 })
    pools.set(connectionString, pool)
  }
  return pool
}

/** @internal */
export function resolveConnectionString(
  configured?: string,
): string | undefined {
  return configured ?? getEnv('SUPABASE_DB_URL')
}

/**
 * The 500 both middleware short-circuit with when no connection string is
 * available, in the package's standard `{ message, code }` error shape.
 *
 * @internal
 */
export function missingConnectionStringResponse(
  middlewareName: string,
): Response {
  return Response.json(
    {
      message: `A Postgres connection string is required. Set SUPABASE_DB_URL, or pass \`connectionString\` to ${middlewareName}.`,
      code: EnvGenericError,
    },
    { status: 500 },
  )
}
