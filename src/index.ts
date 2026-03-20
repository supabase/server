export { withSupabase } from './with-supabase.js'
export { createSupabaseContext } from './create-supabase-context.js'
export { resolveEnv } from './core/resolve-env.js'
export { extractCredentials } from './core/extract-credentials.js'
export { verifyCredentials } from './core/verify-credentials.js'
export { verifyAuth } from './core/verify-auth.js'
export { createContextClient } from './core/create-context-client.js'
export { createAdminClient } from './core/create-admin-client.js'
export type {
  Allow,
  AllowWithKey,
  AuthResult,
  Credentials,
  JWTClaims,
  SupabaseContext,
  SupabaseEnv,
  UserIdentity,
  WithSupabaseConfig,
} from './types.js'
export { AuthError, EnvError } from './errors.js'
