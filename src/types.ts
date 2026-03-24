import type { SupabaseClient } from '@supabase/supabase-js'

export type Allow = 'always' | 'public' | 'secret' | 'user'
export type AllowWithKey = Allow | `public:${string}` | `secret:${string}`

export interface SupabaseEnv {
  url: string
  publishableKeys: Record<string, string>
  secretKeys: Record<string, string>
  jwks: JsonWebKeySet | null
}

export interface JsonWebKeySet {
  keys: JsonWebKey[]
}

export interface Credentials {
  token: string | null
  apikey: string | null
}

export interface AuthResult {
  authType: Allow
  token: string | null
  userClaims: UserClaims | null
  claims: JWTClaims | null
  keyName?: string | null
}

export interface JWTClaims {
  sub: string
  iss?: string
  aud?: string | string[]
  exp?: number
  iat?: number
  role?: string
  email?: string
  app_metadata?: Record<string, unknown>
  user_metadata?: Record<string, unknown>
  [key: string]: unknown
}

export interface UserClaims {
  id: string
  role?: string
  email?: string
  appMetadata?: Record<string, unknown>
  userMetadata?: Record<string, unknown>
}

export interface WithSupabaseConfig {
  allow?: AllowWithKey | AllowWithKey[]
  env?: Partial<SupabaseEnv>
  cors?: boolean | Record<string, string>
}

export interface SupabaseContext<Database = unknown> {
  supabase: SupabaseClient<Database>
  supabaseAdmin: SupabaseClient<Database>
  /** JWT-derived identity. For the full Supabase User object, call `supabase.auth.getUser()`. */
  userClaims: UserClaims | null
  claims: JWTClaims | null
  authType: Allow
}
