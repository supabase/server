import { getEnv } from '@supabase/middleware'
import pg from 'pg'

import { errorResponse } from '../error-response.js'
import {
  Errors,
  MissingConnectionStringError,
  PostgresConnectPausedError,
  PostgresPoolBusyError,
  messageOf,
} from '../errors.js'
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
 * How long a checkout waits for a free connection before failing, and how
 * long a new connection may take to come up. Supavisor's own checkout timeout
 * is sixty seconds; this has to expire well before it so the failure surfaces
 * here, where the message can say what happened.
 *
 * @internal
 */
export const CHECKOUT_TIMEOUT_MS = 10_000

const LOG_PREFIX = '[@supabase/server] postgres pool:'

/**
 * **Alpha.** Pool sizing for `withPostgresClient` and
 * `withPostgresAdminClient`. Two entries on the same connection string share
 * a pool only when their options resolve to the same values.
 *
 * The composable middleware surface tracks `@supabase/middleware` 0.x — entry
 * shapes, context keys, and config options may change between 0.x releases.
 *
 * @alpha
 * @category Middleware
 */
export interface PostgresPoolOptions {
  /**
   * Connections this process opens at most on this connection string. A
   * positive integer. The pooler team recommends one to four for serverless
   * deployments.
   *
   * @defaultValue 4
   */
  max?: number
  /**
   * Milliseconds a query waits for a free connection before failing with
   * `POSTGRES_POOL_BUSY`, and how long a new connection may take to come up.
   * A positive number. Keep it well under the pooler's own 60 second checkout
   * timeout so the failure surfaces here, with a message that says what
   * happened.
   *
   * @defaultValue 10000
   */
  checkoutTimeoutMs?: number
}

/** @internal */
export interface ResolvedPoolOptions {
  max: number
  checkoutTimeoutMs: number
}

/** @internal */
export const DEFAULT_POOL_OPTIONS: ResolvedPoolOptions = {
  max: POOL_MAX,
  checkoutTimeoutMs: CHECKOUT_TIMEOUT_MS,
}

/**
 * Fill in the defaults and refuse values the pool cannot run with. Called
 * when a middleware is built, so a bad value fails the deploy rather than the
 * first request.
 *
 * @internal
 */
export function resolvePoolOptions(
  options?: PostgresPoolOptions,
): ResolvedPoolOptions {
  const max = options?.max ?? POOL_MAX
  if (!Number.isInteger(max) || max < 1) {
    throw new RangeError(
      `[@supabase/server] pool.max must be a positive integer (received ${max})`,
    )
  }
  const checkoutTimeoutMs = options?.checkoutTimeoutMs ?? CHECKOUT_TIMEOUT_MS
  if (!Number.isFinite(checkoutTimeoutMs) || checkoutTimeoutMs <= 0) {
    throw new RangeError(
      `[@supabase/server] pool.checkoutTimeoutMs must be a positive number of milliseconds (received ${checkoutTimeoutMs})`,
    )
  }
  return { max, checkoutTimeoutMs }
}

// Names this traffic in pooler-side logs. An `application_name` in the
// connection string itself takes precedence: pg merges the parsed string over
// the config object when it builds a client.
function applicationName(): string {
  const slug = getEnv('SUPABASE_FUNCTION_SLUG')
  return slug ? `supabase-server:${slug}` : 'supabase-server'
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
 * A checked-out connection: run statements on it, then release it.
 *
 * @internal
 */
export interface PooledClient {
  query(text: string, params?: unknown[]): Promise<pg.QueryResult>
  /**
   * Return the connection to the pool. A truthy argument discards it instead,
   * as `pg.PoolClient#release` does.
   */
  release(destroy?: Error | boolean): void
}

/**
 * The pool as the middleware see it: `pg.Pool`'s checkout and one-shot query,
 * paced by a connect-failure backoff.
 *
 * @internal
 */
export interface PostgresPool {
  /**
   * Check a connection out. Waits up to the pool's checkout timeout for a
   * free slot, and rejects without trying while new connection attempts are
   * paused after a failure, so a bad credential cannot storm the pooler.
   * Both refusals are `PostgresPoolError` instances, coded
   * `POSTGRES_POOL_BUSY` and `POSTGRES_CONNECT_PAUSED`.
   */
  connect(): Promise<PooledClient>
  /** Check out, run one statement, release — like `pg.Pool#query`. */
  query(text: string, params?: unknown[]): Promise<pg.QueryResult>
  readonly pool: pg.Pool
}

/** @internal */
export function createPostgresPool(
  pool: pg.Pool,
  backoff: ConnectBackoff,
): PostgresPool {
  const max = pool.options.max
  const checkoutTimeoutMs =
    pool.options.connectionTimeoutMillis ?? CHECKOUT_TIMEOUT_MS
  // The wrapper, not pg-pool, holds the line on how many checkouts are in
  // flight. pg-pool hands the next item in its own queue a fresh connection
  // attempt the moment one fails, so a queue it owns turns one bad credential
  // into a burst of attempts before any pause can start.
  let admitted = 0
  const waiters: Array<() => void> = []

  // pg-pool emits 'connect' only for a physically new connection, which is
  // the one event that proves connecting works again.
  pool.on('connect', () => backoff.succeed())

  function acquireSlot(): Promise<void> {
    if (admitted < max) {
      admitted += 1
      return Promise.resolve()
    }
    return new Promise((resolve, reject) => {
      const wake = () => {
        clearTimeout(timer)
        resolve()
      }
      const timer = setTimeout(() => {
        const i = waiters.indexOf(wake)
        if (i !== -1) waiters.splice(i, 1)
        reject(
          Errors[PostgresPoolBusyError]({
            max,
            waitedMs: checkoutTimeoutMs,
          }),
        )
      }, checkoutTimeoutMs)
      ;(timer as { unref?: () => void }).unref?.()
      waiters.push(wake)
    })
  }

  function releaseSlot(): void {
    const next = waiters.shift()
    if (next) next()
    else admitted -= 1
  }

  async function connect(): Promise<PooledClient> {
    await acquireSlot()

    const remaining = backoff.remainingMs()
    // Refuse only a checkout that would open a new connection. pg-pool hands
    // idle connections to its pending checkouts first, at the next tick, so an
    // idle connection is spare for this one only when there are more idle than
    // pending. A checkout that is opening its own connection is neither.
    if (remaining > 0 && pool.idleCount <= pool.waitingCount) {
      releaseSlot()
      throw Errors[PostgresConnectPausedError]({
        remainingMs: remaining,
        cause: backoff.lastError(),
      })
    }

    let client: pg.PoolClient
    try {
      client = await pool.connect()
    } catch (e) {
      releaseSlot()
      const pause = backoff.fail(e)
      if (pause > 0) {
        console.error(
          `${LOG_PREFIX} connection failed, pausing new connections for ${pause}ms: ${messageOf(e)}`,
        )
      }
      throw e
    }

    let released = false
    return {
      query: (text, params) => client.query(text, params),
      release(destroy) {
        // The slot comes back exactly once, whatever pg-pool does with the
        // release: a throw on the first call must not lose it for the life of
        // the process, and pg-pool throwing on a second call must not return
        // it twice.
        try {
          if (destroy === undefined) client.release()
          else client.release(destroy)
        } finally {
          if (!released) {
            released = true
            releaseSlot()
          }
        }
      },
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

// One pool per connection string and pool options per process, lazily
// created. Keyed rather than a bare singleton so two handlers pointed at
// different databases in the same process don't share one pool, and so two
// entries that size the pool differently each get the pool they asked for.
//
// The scoped and admin middleware deliberately share this cache: they use the
// same connection string, and the only difference is whether the transaction
// preamble runs. Both `set_config(..., true)` and `SET LOCAL` are
// transaction-local, so a connection always returns to the pool clean — an
// admin query can never inherit a previous caller's claims or role.
const pools = new Map<string, PostgresPool>()

/** @internal */
export function getPool(
  connectionString: string,
  options: ResolvedPoolOptions = DEFAULT_POOL_OPTIONS,
): PostgresPool {
  const key = JSON.stringify([
    connectionString,
    options.max,
    options.checkoutTimeoutMs,
  ])
  let entry = pools.get(key)
  if (!entry) {
    const pool = new Pool({
      connectionString,
      max: options.max,
      // Caps how long a new connection may take to come up. Waiting for a
      // free slot happens in the wrapper, never in pg-pool's queue.
      connectionTimeoutMillis: options.checkoutTimeoutMs,
      application_name: applicationName(),
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
    pools.set(key, entry)
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
