import { getEnv } from '@supabase/middleware'
import pg from 'pg'

import { errorResponse } from '../error-response.js'
import { Errors, MissingConnectionStringError } from '../errors.js'
import type { ErrorResponseConfig } from '../types.js'
import { createConnectBackoff } from './postgres-backoff.js'
import type { ConnectBackoff } from './postgres-backoff.js'

const { Pool } = pg

/**
 * Connections per process. The pooler team recommends a client-side pool of
 * one to four for serverless deployments.
 *
 * @internal
 */
export const POOL_MAX = 4

/**
 * How long a checkout waits for a free connection — or for a new one to
 * connect — before failing. Supavisor's own checkout timeout is sixty
 * seconds; this has to expire well before it so the failure surfaces here,
 * where the message can say what happened.
 *
 * @internal
 */
export const CHECKOUT_TIMEOUT_MS = 10_000

// pg-pool's queue-wait timeout carries no code; the message is the only
// handle on it.
const QUEUE_TIMEOUT_MESSAGE = 'timeout exceeded when trying to connect'

const LOG_PREFIX = '[@supabase/server] postgres pool:'

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

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
   * `pg` returns `date`, `timestamp`, and `timestamptz` columns as `Date`
   * objects. Declare those fields as `Date` in the row type, or cast in SQL
   * (`day::text as day`) when the value feeds a PostgREST filter or a JSON
   * body.
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

/**
 * The pool as the middleware see it: `pg.Pool`'s checkout and one-shot query,
 * paced by a connect-failure backoff.
 *
 * @internal
 */
export interface PostgresPool {
  /**
   * Check a connection out. Rejects immediately while new connection attempts
   * are paused after a failure, so a bad credential cannot storm the pooler.
   */
  connect(): Promise<pg.PoolClient>
  /** Check out, run one statement, release — like `pg.Pool#query`. */
  query(text: string, params?: unknown[]): Promise<pg.QueryResult>
  readonly pool: pg.Pool
}

/** @internal */
export function createPostgresPool(
  pool: pg.Pool,
  backoff: ConnectBackoff,
): PostgresPool {
  // pg-pool emits 'connect' only for a physically new connection, which is
  // the one event that proves connecting works again.
  pool.on('connect', () => backoff.succeed())

  async function connect(): Promise<pg.PoolClient> {
    const remaining = backoff.remainingMs()
    // Only a checkout that would open a new connection is refused. With an
    // idle connection pg-pool reuses it, and with every slot taken it queues
    // for a release; neither touches the pooler.
    if (remaining > 0 && pool.idleCount === 0 && pool.totalCount < POOL_MAX) {
      const cause = backoff.lastError()
      throw new Error(
        `${LOG_PREFIX} new connections paused for ${remaining}ms after a connection failure: ${messageOf(cause)}`,
        { cause },
      )
    }

    try {
      return await pool.connect()
    } catch (e) {
      if (e instanceof Error && e.message === QUEUE_TIMEOUT_MESSAGE) {
        // Waiting out a busy pool says nothing about whether connecting works.
        e.message += ` (all ${POOL_MAX} pooled connections were busy for ${CHECKOUT_TIMEOUT_MS}ms)`
        throw e
      }
      const pause = backoff.fail(e)
      if (pause > 0) {
        console.error(
          `${LOG_PREFIX} connection failed, pausing new connections for ${pause}ms: ${messageOf(e)}`,
        )
      }
      throw e
    }
  }

  async function query(
    text: string,
    params?: unknown[],
  ): Promise<pg.QueryResult> {
    const client = await connect()
    try {
      const res = await client.query(text, params)
      client.release()
      return res
    } catch (e) {
      // pg-pool's own query() releases with the error, which discards the
      // connection rather than returning it to the pool.
      client.release(e instanceof Error ? e : true)
      throw e
    }
  }

  return { connect, query, pool }
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
const pools = new Map<string, PostgresPool>()

/** @internal */
export function getPool(connectionString: string): PostgresPool {
  let entry = pools.get(connectionString)
  if (!entry) {
    const pool = new Pool({
      connectionString,
      max: POOL_MAX,
      // Applies both to waiting for a free slot and to connecting a new
      // client, so a saturated pool fails the request once the wait runs out.
      connectionTimeoutMillis: CHECKOUT_TIMEOUT_MS,
    })
    // A backend can die under any pooled connection at any time — pooler
    // restart, failover, idle-connection reap. pg surfaces that as an 'error'
    // event on the pool (idle client) or on the client itself (checked out
    // with no query in flight), and an 'error' event with no listener is
    // fatal to the whole process. Both listeners must exist so a dropped
    // connection stays a per-request failure: the in-flight query rejects
    // and the pool discards the dead client.
    pool.on('error', (e) => {
      console.error(
        `${LOG_PREFIX} idle connection lost (discarded): ${e.message}`,
      )
    })
    pool.on('connect', (client) => {
      client.on('error', (e) => {
        console.error(`${LOG_PREFIX} connection lost: ${e.message}`)
      })
    })
    entry = createPostgresPool(
      pool,
      createConnectBackoff({ now: Date.now, random: Math.random }),
    )
    pools.set(connectionString, entry)
  }
  return entry
}

/** @internal */
export function resolveConnectionString(
  configured?: string,
): string | undefined {
  return configured ?? getEnv('SUPABASE_DB_URL')
}

/**
 * The 500 both middleware short-circuit with when no connection string is
 * available, in the package's standard error payload.
 *
 * @internal
 */
export function missingConnectionStringResponse(
  middlewareName: string,
  errors?: ErrorResponseConfig,
): Response {
  return errorResponse(Errors[MissingConnectionStringError](middlewareName), {
    errors,
  })
}
