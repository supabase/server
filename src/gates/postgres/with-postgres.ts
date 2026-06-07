/**
 * `withPostgres` — injects an RLS-scoped Postgres client at `ctx.postgres`.
 *
 * Each operation runs as the caller's JWT (claims + connection role pinned to a
 * single transaction, PostgREST-style), so `auth.uid()` and RLS policies behave
 * exactly as they do through PostgREST. Use it when you need raw SQL but still
 * want Supabase's auth model.
 *
 * Requires an upstream gate to provide `jwtClaims` (e.g. `withSupabase`) — the
 * `In` shape makes composing it standalone a type error. The `pg` import is
 * confined to this subpath; it runs only on Node/Deno, not Workers/edge.
 */

import type { Pool } from 'pg'

import { defineGate, type Gate } from '../../core/gates/index.js'
import type { JWTClaims } from '../../types.js'

import { type Db, type Role, getPool, authedDb } from './db.js'

/** Per-instance configuration for `withPostgres(config, handler)`. */
export interface PostgresConfig {
  /**
   * Pool to draw connections from. When omitted, a lazily-created module-level
   * pool backed by `SUPABASE_DB_URL` is used (shared across requests).
   */
  pool?: Pool
}

/**
 * Clamp the *connection role* to `authenticated` / `anon` — never let a token
 * claim flip the user client into an RLS-bypassing role. `service_role` belongs
 * to {@link withPostgresAdmin}, not here.
 */
function userRole(claims: JWTClaims | null): Role {
  return claims?.role === 'authenticated' ? 'authenticated' : 'anon'
}

/**
 * Postgres gate — contributes an RLS-scoped {@link Db} at `ctx.postgres`.
 *
 * @example
 * ```ts
 * import { withSupabase } from '@supabase/server'
 * import { withPostgres } from '@supabase/server/gates/postgres'
 *
 * export default {
 *   fetch: withSupabase({ auth: 'user' },
 *     withPostgres({}, async (_req, ctx) => {
 *       // auth.uid() = ctx.jwtClaims.sub; RLS applies
 *       const mine = await ctx.postgres.query('select * from notes')
 *       return Response.json({ notes: mine.rows })
 *     })),
 * }
 * ```
 */
export const withPostgres: Gate<
  'postgres',
  PostgresConfig,
  { jwtClaims: JWTClaims | null },
  Db
> = defineGate<'postgres', PostgresConfig, { jwtClaims: JWTClaims | null }, Db>(
  {
    key: 'postgres',
    run: (config) => async (_req, ctx) => {
      const pool = getPool(config.pool)
      const claims = ctx.jwtClaims ?? { role: 'anon' }
      return { postgres: authedDb(pool, claims, userRole(ctx.jwtClaims)) }
    },
  },
)
