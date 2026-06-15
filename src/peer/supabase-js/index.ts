/**
 * Curated re-exports of the most commonly needed types from
 * `@supabase/supabase-js`.
 *
 * `@supabase/supabase-js` is a required peer dependency, so these are always
 * resolvable at the consumer's install site. Re-exporting them here lets users
 * type their own helpers (`function f(client: SupabaseClient) {}`), narrow
 * Postgrest responses, and reference auth objects without reaching into a
 * second package — `@supabase/server` becomes a single import surface.
 *
 *
 * @packageDocumentation
 */

export type {
  // Client
  SupabaseClient,
  SupabaseClientOptions,

  // Postgrest (querying)
  PostgrestError,
  PostgrestResponse,
  PostgrestSingleResponse,
  PostgrestMaybeSingleResponse,
  QueryData,
  QueryError,
  QueryResult,

  // Auth identity
  User,
  Session,
  UserResponse,
  AuthResponse,
} from '@supabase/supabase-js'
