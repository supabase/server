/**
 * Server-side Supabase utilities for modern runtimes.
 * @packageDocumentation
 */

export { withSupabase } from './with-supabase.js'
export { createSupabaseContext } from './create-supabase-context.js'

export type {
  Allow,
  AllowWithKey,
  AuthResult,
  Credentials,
  JWTClaims,
  SupabaseContext,
  SupabaseEnv,
  UserClaims,
  WithSupabaseConfig,
} from './types.js'
export { AuthError, EnvError } from './errors.js'
