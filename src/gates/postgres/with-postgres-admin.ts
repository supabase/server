/**
 * `withPostgresAdmin` — injects an RLS-bypassing Postgres client at
 * `ctx.postgresAdmin`.
 *
 * The client stays as the connection role and sets no JWT claims, so RLS does
 * not apply. It has no upstream prerequisites — use it for trusted, server-side
 * work that must see every row. The `pg` import is confined to this subpath; it
 * runs only on Node/Deno, not Workers/edge.
 */

import type { Pool } from 'pg'

import { defineGate, type Gate } from '../../core/gates/index.js'

import { type Db, getPool, adminDb } from './db.js'

/** Per-instance configuration for `withPostgresAdmin(config, handler)`. */
export interface PostgresAdminConfig {
  /**
   * Pool to draw connections from. When omitted, a lazily-created module-level
   * pool backed by `SUPABASE_DB_URL` is used (shared across requests).
   */
  pool?: Pool
}

/**
 * Postgres admin gate — contributes an RLS-bypassing {@link Db} at
 * `ctx.postgresAdmin`.
 *
 * @example
 * ```ts
 * import { withPostgresAdmin } from '@supabase/server/gates/postgres'
 *
 * export default {
 *   fetch: withPostgresAdmin({}, async (_req, ctx) => {
 *     const all = await ctx.postgresAdmin.query('select count(*) from notes')
 *     return Response.json({ total: all.rows[0].count })
 *   }),
 * }
 * ```
 */
export const withPostgresAdmin: Gate<
  'postgresAdmin',
  PostgresAdminConfig,
  Record<never, never>,
  Db
> = defineGate<'postgresAdmin', PostgresAdminConfig, Record<never, never>, Db>({
  key: 'postgresAdmin',
  run: (config) => async () => ({
    postgresAdmin: adminDb(getPool(config.pool)),
  }),
})
