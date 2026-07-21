import { defineMiddleware, getEnv } from '@supabase/middleware'
import pg from 'pg'

const { Pool } = pg

// One pool per process, lazily created (config or SUPABASE_DB_URL).
let pool: pg.Pool | undefined
function getPool(connectionString: string): pg.Pool {
  if (!pool) pool = new Pool({ connectionString, max: 4 })
  return pool
}

/**
 * Minimal claims shape {@link withPostgres} needs on the upstream context.
 *
 * Satisfied both by `withSupabase`'s JWKS-verified `ctx.jwtClaims` and by the
 * standalone `withClaims` middleware — `withPostgres` only reads `role` and
 * serializes the whole object into `request.jwt.claims`.
 */
interface RequestClaims {
  role?: string
  [key: string]: unknown
}

/**
 * The `ctx.postgres` client contributed by {@link withPostgres}.
 *
 * @category Middleware
 */
export interface PostgresApi {
  /** Run a query inside the caller's RLS-scoped transaction. */
  query<T = Record<string, unknown>>(
    text: string,
    params?: unknown[],
  ): Promise<T[]>
}

/**
 * Configuration for {@link withPostgres}.
 *
 * @category Middleware
 */
export interface WithPostgresConfig {
  /** Defaults to `getEnv('SUPABASE_DB_URL')` (from `@supabase/middleware`). */
  connectionString?: string
}

/**
 * Contributes `ctx.postgres` — an RLS-scoped `pg` client, the safe version of
 * "authenticate, then query as the user". Every query runs in its own short
 * transaction that injects the caller's claims and drops to their role, exactly
 * like PostgREST:
 *
 * ```sql
 * begin;
 * select set_config('request.jwt.claims', $claims, true);  -- auth.uid() resolves
 * set local role authenticated;                            -- RLS now enforces
 * <your query>
 * commit;
 * ```
 *
 * Everything is transaction-local, so nothing leaks onto the pooled connection.
 *
 * Reads the caller's claims from `ctx.jwtClaims`, which `withSupabase` already
 * populates (JWKS-verified) — so inside `withSupabase` you compose it directly:
 *
 * ```ts
 * withSupabase({ auth: 'user', middleware: [withPostgres()] }, handler)
 * ```
 *
 * Standalone (no `withSupabase`), pair it with `withClaims` so `ctx.jwtClaims`
 * is present before it runs.
 *
 * > **Table grants.** Queries run as `authenticated` or `anon`, so those
 * > roles need explicit table privileges (e.g. `grant select, insert on
 * > <table> to authenticated`) in addition to RLS policies. A missing grant
 * > fails with `permission denied` (SQLSTATE 42501) before RLS is consulted.
 *
 * > **Runtime note.** `pg` needs raw TCP, so this runs on Node/Deno (including
 * > the Supabase Edge runtime), **not** on Workers-style isolates.
 *
 * @category Middleware
 */
export const withPostgres = defineMiddleware<
  'postgres',
  WithPostgresConfig | void,
  { jwtClaims: RequestClaims | null },
  PostgresApi
>({
  key: 'postgres',
  run: (config) => async (_req, ctx) => {
    const connectionString =
      config?.connectionString ?? getEnv('SUPABASE_DB_URL')
    if (!connectionString) {
      return Response.json({ error: 'no SUPABASE_DB_URL' }, { status: 500 })
    }

    const p = getPool(connectionString)
    const claims = ctx.jwtClaims
    // Clamp the role — a token can never flip the client into an RLS-bypassing
    // role. service_role is deliberately not reachable here.
    const role = claims?.role === 'authenticated' ? 'authenticated' : 'anon'

    const api: PostgresApi = {
      async query<T = Record<string, unknown>>(
        text: string,
        params?: unknown[],
      ) {
        const client = await p.connect()
        try {
          await client.query('begin')
          await client.query(
            `select set_config('request.jwt.claims', $1, true)`,
            [JSON.stringify(claims ?? {})],
          )
          await client.query(`set local role ${role}`) // role is a clamped literal
          const res = await client.query(text, params)
          await client.query('commit')
          return res.rows as T[]
        } catch (e) {
          await client.query('rollback')
          // 42501 insufficient_privilege: the role lacks table grants.
          if (e instanceof Error && (e as { code?: string }).code === '42501') {
            e.message += ` (RLS-scoped queries run as the caller's role '${role}' — grant that role the table privileges it needs, e.g. "grant select on <table> to ${role}")`
          }
          throw e
        } finally {
          client.release()
        }
      },
    }

    return { postgres: api }
  },
})
