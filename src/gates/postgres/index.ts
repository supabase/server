/**
 * Postgres gate.
 *
 * Node/Deno-only — this gate uses `pg` and does not run on Workers/edge.
 *
 * @packageDocumentation
 */

export { withPostgres } from './with-postgres.js'
export type { PostgresConfig, Postgres } from './with-postgres.js'
export type { Db } from './db.js'
