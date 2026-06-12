/**
 * Server-side Supabase utilities for modern runtimes.
 * @packageDocumentation
 */

export { withSupabase } from './with-supabase.js'
export { createSupabaseContext } from './create-supabase-context.js'

export type {
  Allow,
  AllowWithKey,
  AuthMode,
  AuthModeWithKey,
  AuthResult,
  ClientAuth,
  CreateAdminClientOptions,
  CreateContextClientOptions,
  Credentials,
  JWTClaims,
  SupabaseContext,
  SupabaseEnv,
  UserClaims,
  WithSupabaseConfig,
} from './types.js'

export {
  AuthError,
  AuthGenericError,
  CreateSupabaseClientError,
  EnvError,
  EnvGenericError,
  Errors,
  InvalidCredentialsError,
  MissingDefaultPublishableKeyError,
  MissingDefaultSecretKeyError,
  MissingPublishableKeyError,
  MissingSecretKeyError,
  MissingSupabaseURLError,
} from './errors.js'

// Curated re-exports of commonly needed `@supabase/supabase-js` types so
// `@supabase/server` is a single import surface. See ./supabase-js.ts.
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
} from './supabase-js.js'
