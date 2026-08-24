import { defineMiddleware } from '@supabase/middleware'
import type { Middleware } from '@supabase/middleware'

import {
  getPool,
  missingConnectionStringResponse,
  resolveConnectionString,
} from '../../core/postgres-pool.js'
import type { PostgresApi } from '../../core/postgres-pool.js'
import { compileTemplate, ident } from '../../core/sql.js'

export type { PostgresApi }
// `ident` is exported here rather than only from core: it is the companion
// to `queryRaw`, so it belongs on the subpath a caller already imports.
export { ident }

/**
 * Configuration for {@link withPostgresAdminClient}.
 *
 * @category Middleware
 */
export interface WithPostgresAdminClientConfig {
  /** Defaults to `getEnv('SUPABASE_DB_URL')` (from `@supabase/middleware`). */
  connectionString?: string
}

/**
 * Contributes `ctx.postgresAdmin` — a `pg` client that **bypasses RLS**, for
 * full-table access. The direct-connection counterpart to
 * `withSupabaseAdminClient`, and the deliberate opt-out from the guardrails
 * `withPostgresClient` (`@supabase/server/middleware/postgres`) enforces.
 *
 * Queries run as-is, as the role in the connection string: no claim injection,
 * no role switching, no wrapping transaction. Whatever that role may read, the
 * caller may read.
 *
 * Unlike `withPostgresClient` this declares **no upstream prerequisite** — it
 * never looks at `ctx.jwtClaims`, so it composes in any auth mode, including
 * `auth: 'secret'` and `auth: 'none'`:
 *
 * ```ts
 * import { withSupabase } from '@supabase/server'
 * import { withPostgresAdminClient } from '@supabase/server/middleware/postgres-admin'
 *
 * export default {
 *   fetch: withSupabase(
 *     { auth: 'secret', middleware: [withPostgresAdminClient()] },
 *     async (_req, ctx) => {
 *       const rows = await ctx.postgresAdmin.query`select user_id, count(*) from notes group by user_id`
 *       return Response.json(rows)
 *     },
 *   ),
 * }
 * ```
 *
 * Compose both halves when a handler needs each in turn — they share one pool,
 * and `ctx.postgres` stays RLS-scoped regardless:
 *
 * ```ts
 * middleware: [withPostgresClient(), withPostgresAdminClient()]
 * ```
 *
 * > **Authorization is yours now.** RLS is not consulted, so any per-user
 * > scoping has to be a `where` clause you write. Reach for
 * > `withPostgresClient` unless you specifically need to cross user
 * > boundaries.
 *
 * > **Runtime note.** `pg` needs raw TCP, so this runs on Node/Deno (including
 * > the Supabase Edge runtime), **not** on Workers-style isolates.
 *
 * @category Middleware
 */
export const withPostgresAdminClient: Middleware<
  'postgresAdmin',
  WithPostgresAdminClientConfig | void,
  Record<never, never>,
  PostgresApi
> = defineMiddleware<
  'postgresAdmin',
  WithPostgresAdminClientConfig | void,
  Record<never, never>,
  PostgresApi
>({
  key: 'postgresAdmin',
  run: (config) => async () => {
    const connectionString = resolveConnectionString(config?.connectionString)
    if (!connectionString) {
      return missingConnectionStringResponse('withPostgresAdminClient')
    }

    const p = getPool(connectionString)

    const api: PostgresApi = {
      query<T = Record<string, unknown>>(
        strings: TemplateStringsArray,
        ...values: unknown[]
      ) {
        const compiled = compileTemplate(strings, values)
        return api.queryRaw<T>(compiled.text, compiled.values)
      },
      async queryRaw<T = Record<string, unknown>>(
        text: string,
        params?: unknown[],
      ) {
        // No transaction preamble: pool.query checks a connection out and back
        // for us, and there is no session state to set up or tear down.
        const res = await p.query(text, params)
        return res.rows as T[]
      },
    }

    return { postgresAdmin: api }
  },
})
