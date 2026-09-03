import { defineMiddleware } from '@supabase/middleware'
import type { Middleware } from '@supabase/middleware'

import {
  getPool,
  missingConnectionStringResponse,
  resolveConnectionString,
} from '../../core/postgres-pool.js'
import type { PostgresApi } from '../../core/postgres-pool.js'
import { compileTemplate, ident } from '../../core/sql.js'
import { errorResponse } from '../../error-response.js'
import { Errors, UnsupportedRoleError } from '../../errors.js'

export type { PostgresApi }
// `ident` is exported here rather than only from core: it is the companion
// to `queryRaw`, so it belongs on the subpath a caller already imports.
export { ident }

/**
 * Roles this middleware will drop into. Deliberately not a denylist: we
 * connect with `SUPABASE_DB_URL`, which on Supabase is `postgres` — a role
 * with `BYPASSRLS` that can `SET ROLE` into almost anything. PostgREST needs
 * no such list because it connects as the unprivileged `authenticator`, where
 * `grant <role> to authenticator` *is* the authorization.
 *
 * Custom roles are legitimate on Supabase and RLS still applies to them, so
 * this list is a v1 limitation rather than a security boundary — see the
 * refusal message below.
 */
const SUPPORTED_ROLES = new Set(['authenticated', 'anon'])

/**
 * Resolve the role to assume, or a short-circuit `Response` explaining why we
 * will not. Never silently downgrades a role the caller explicitly asked for:
 * that returns zero rows and leaves nothing to debug.
 */
function resolveRole(claims: RequestClaims | null): string | Response {
  // `role` is typed as a string, but claims come from a token — a
  // misconfigured custom-claims hook can put anything here.
  const requested = claims?.role as unknown

  // No verified caller, or a token that names no role at all — anonymous is
  // the expected outcome, not a downgrade.
  if (requested == null) return 'anon'

  if (typeof requested === 'string' && SUPPORTED_ROLES.has(requested)) {
    return requested
  }

  return errorResponse(
    Errors[UnsupportedRoleError]({
      requestedRole: requested,
      supportedRoles: [...SUPPORTED_ROLES],
    }),
  )
}

/**
 * **Alpha.** Minimal claims shape {@link withPostgresClient} needs on the
 * upstream context.
 *
 * Satisfied both by `withSupabase`'s JWKS-verified `ctx.jwtClaims` and by the
 * standalone `withClaims` middleware — `withPostgresClient` only reads `role`
 * and serializes the whole object into `request.jwt.claims`.
 *
 * The composable middleware surface tracks `@supabase/middleware` 0.x — entry
 * shapes, context keys, and config options may change between 0.x releases.
 *
 * @alpha
 * @category Middleware
 */
export interface RequestClaims {
  role?: string
  [key: string]: unknown
}

/**
 * **Alpha.** Configuration for {@link withPostgresClient}.
 *
 * The composable middleware surface tracks `@supabase/middleware` 0.x — entry
 * shapes, context keys, and config options may change between 0.x releases.
 *
 * @alpha
 * @category Middleware
 */
export interface WithPostgresClientConfig {
  /** Defaults to `getEnv('SUPABASE_DB_URL')` (from `@supabase/middleware`). */
  connectionString?: string
}

/**
 * **Alpha.** Contributes `ctx.postgres` — an RLS-scoped `pg` client, the safe
 * version of "authenticate, then query as the user". This is the
 * direct-connection counterpart to `withSupabaseClient`, and its service-role
 * companion is `withPostgresAdminClient`
 * (`@supabase/server/middleware/postgres-admin`).
 *
 * Every query runs in its own short transaction that injects the caller's
 * claims and drops to their role, exactly like PostgREST:
 *
 * ```sql
 * begin;
 * select set_config('request.jwt.claims', $claims, true);  -- auth.uid() resolves
 * set local role "authenticated";                          -- RLS now enforces
 * <your query>
 * commit;
 * ```
 *
 * Everything is transaction-local, so nothing leaks onto the pooled connection.
 *
 * Only `authenticated` and `anon` are assumed. A token naming any other role —
 * including `service_role` — is **refused** with a 500 and
 * `code: 'UNSUPPORTED_ROLE'`, never silently downgraded to `anon`: running the
 * query as the wrong identity would return zero rows and leave nothing to
 * debug. Bypassing RLS is a separate, explicit opt-in: compose
 * `withPostgresAdminClient`.
 *
 * > **Custom roles.** Supabase supports custom Postgres roles via the `role`
 * > claim, and RLS still applies to them. They are not supported here yet, so
 * > such a token is refused rather than downgraded.
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
 * The composable middleware surface tracks `@supabase/middleware` 0.x — entry
 * shapes, context keys, and config options may change between 0.x releases.
 *
 * @alpha
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

    const claims = ctx.jwtClaims
    const role = resolveRole(claims)
    // Refused before the handler runs and before a connection is checked out.
    if (role instanceof Response) return role

    const p = getPool(connectionString)
    // Fixed for the request, so serialize once rather than per query.
    const claimsJson = JSON.stringify(claims ?? {})

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
        const client = await p.connect()
        // Set when the transaction could not be unwound, so the connection is
        // discarded rather than pooled — see the catch below.
        let poisoned = false
        try {
          await client.query('begin')
          await client.query(
            `select set_config('request.jwt.claims', $1, true)`,
            [claimsJson],
          )
          // `role` is one of SUPPORTED_ROLES, so this interpolation is already
          // safe; quoting it keeps that true if the allowlist ever widens to
          // the custom roles the docstring promises.
          await client.query(`set local role ${ident(role)}`)
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
