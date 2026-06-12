/**
 * Composable primitives for constructing a {@link SupabaseContext}.
 * @packageDocumentation
 */

export { resolveEnv } from './resolve-env.js'
export { extractCredentials } from './extract-credentials.js'
export { verifyCredentials } from './verify-credentials.js'
export { verifyAuth } from './verify-auth.js'
export { createContextClient } from './create-context-client.js'
export { createAdminClient } from './create-admin-client.js'

export type {
  ClientAuth,
  CreateAdminClientOptions,
  CreateContextClientOptions,
} from '../types.js'

// Curated re-exports of commonly needed `@supabase/supabase-js` types so the
// clients returned by `createContextClient` / `createAdminClient` can be typed
// without reaching into a second package. See ../supabase-js.ts.
export type {
  AuthResponse,
  PostgrestError,
  PostgrestMaybeSingleResponse,
  PostgrestResponse,
  PostgrestSingleResponse,
  QueryData,
  QueryError,
  QueryResult,
  Session,
  SupabaseAuthError,
  SupabaseClient,
  SupabaseClientOptions,
  User,
  UserResponse,
} from '../supabase-js.js'
