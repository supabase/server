import { defineMiddleware } from '@supabase/middleware'
import type { Middleware } from '@supabase/middleware'

import {
  getPool,
  missingConnectionStringResponse,
  resolveConnectionString,
} from '../../core/postgres-pool.js'
import type { PostgresApi } from '../../core/postgres-pool.js'

export type { PostgresApi }

/**
 * Minimal claims shape {@link withPostgresClient} needs on the upstream context.
 *
 * Satisfied both by `withSupabase`'s JWKS-verified `ctx.jwtClaims` and by the
 * standalone `withClaims` middleware — `withPostgresClient` only reads `role`
 * and serializes the whole object into `request.jwt.claims`.
 *
 * @category Middleware
 */
export interface RequestClaims {
  role?: string
  [key: string]: unknown
}

/**
 * Configuration for {@link withPostgresClient}.
 *
 * @category Middleware
 */
export interface WithPostgresClientConfig {
  /** Defaults to `getEnv('SUPABASE_DB_URL')` (from `@supabase/middleware`). */
  connectionString?: string
}

/**
 * Contributes `ctx.postgres` — an RLS-scoped `pg` client, the safe version of
 * "authenticate, then query as the user". This is the direct-connection
 * counterpart to `withSupabaseClient`, and its service-role companion is
 * `withPostgresAdminClient` (`@supabase/server/middleware/postgres-admin`).
 *
 * Every query runs in its own short transaction that injects the caller's
 * claims and drops to their role, exactly like PostgREST:
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
 * The role is clamped to `authenticated` or `anon` — a token claiming
 * `role: "service_role"` still runs as `anon`, so a caller can never talk their
 * way into an RLS-bypassing role. Bypassing RLS is a separate, explicit opt-in:
 * compose `withPostgresAdminClient`.
 *
 * Reads the caller's claims from `ctx.jwtClaims`, which `withSupabase` already
 * populates (JWKS-verified) — so inside `withSupabase` you compose it directly:
 *
 * ```ts
 * withSupabase({ auth: 'user', middleware: [withPostgresClient()] }, handler)
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
export const withPostgresClient: Middleware<
  'postgres',
  WithPostgresClientConfig | void,
  { jwtClaims: RequestClaims | null },
  PostgresApi
> = defineMiddleware<
  'postgres',
  WithPostgresClientConfig | void,
  { jwtClaims: RequestClaims | null },
  PostgresApi
>({
  key: 'postgres',
  run: (config) => async (_req, ctx) => {
    const connectionString = resolveConnectionString(config?.connectionString)
    if (!connectionString) {
      return missingConnectionStringResponse('withPostgresClient')
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
        // Set when the transaction could not be unwound, so the connection is
        // discarded rather than pooled — see the catch below.
        let poisoned = false
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
          // A broken connection makes the rollback throw too; that failure
          // must not replace the error the caller actually needs to see.
          try {
            await client.query('rollback')
          } catch {
            // The original error wins — but we can no longer assume the
            // session is clean. The transaction may still be open with the
            // caller's role set, and this pool is shared with
            // withPostgresAdminClient, which begins no transaction and would
            // inherit that state on the next checkout. Discard the connection
            // instead of pooling it.
            poisoned = true
          }
          // 42501 insufficient_privilege: the role lacks table grants.
          if (e instanceof Error && (e as { code?: string }).code === '42501') {
            e.message += ` (RLS-scoped queries run as the caller's role '${role}' — grant that role the table privileges it needs, e.g. "grant select on <table> to ${role}")`
          }
          throw e
        } finally {
          // pg-pool removes the client instead of reusing it when release()
          // gets a truthy argument.
          client.release(poisoned)
        }
      },
    }

    return { postgres: api }
  },
})
