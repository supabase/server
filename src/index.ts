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
