/**
 * Postgres gates.
 *
 * Node/Deno-only — these gates use `pg` and do not run on Workers/edge.
 *
 * @packageDocumentation
 */

export { withPostgres } from './with-postgres.js'
export type { PostgresConfig } from './with-postgres.js'
export { withPostgresAdmin } from './with-postgres-admin.js'
export type { PostgresAdminConfig } from './with-postgres-admin.js'
export type { Db } from './db.js'
