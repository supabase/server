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
  /**
   * Run a query written as a tagged template, and return its rows.
   *
   * Every interpolation becomes a bind parameter, so an interpolated value is
   * never SQL text and cannot change the statement's shape:
   *
   * ```ts
   * const rows = await ctx.postgres.query`select * from notes where id = ${id}`
   * // -> select * from notes where id = $1   with values [id]
   * ```
   *
   * Tagged templates cannot carry type arguments, so annotate the binding
   * rather than writing `query<NoteRow>`:
   *
   * ```ts
   * const rows: NoteRow[] = await ctx.postgres.query`select id, body from notes`
   * ```
   *
   * Identifiers — table, column, `order by` direction — cannot be bind
   * parameters in Postgres. Check them against a set you control and quote
   * them with {@link ident}, then use {@link PostgresApi.queryRaw}.
   *
   * Passing a plain string throws, naming `queryRaw`. That is deliberate: the
   * two calls differ only in their brackets, so a silent reinterpretation
   * would be very hard to spot.
   */
  query<T = Record<string, unknown>>(
    strings: TemplateStringsArray,
    ...values: unknown[]
  ): Promise<T[]>

  /**
   * Run a query from SQL text you supply, and return its rows.
   *
   * Safe when every caller-supplied value travels in `params` — that is
   * exactly what {@link PostgresApi.query} compiles to. Reach for this when
   * the text cannot be a literal: a query builder or codegen emitting
   * `{ sql, parameters }`, or SQL that has to interpolate an identifier
   * (quote it with {@link ident} first).
   *
   * ```ts
   * const rows = await ctx.postgres.queryRaw(
   *   'select * from notes where id = $1',
   *   [id],
   * )
   * ```
   *
   * Unlike `query`, this cannot stop you concatenating a value into `text`.
   * The name is the warning, and it greps.
   */
  queryRaw<T = Record<string, unknown>>(
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
