import { createClient, type SupabaseClient } from '@supabase/supabase-js'

import {
  Errors,
  MissingDefaultSecretKeyError,
  MissingSecretKeyError,
} from '../errors.js'
import type { CreateAdminClientOptions } from '../types.js'
import { resolveEnv } from './resolve-env.js'

/**
 * Creates an admin Supabase client that bypasses Row-Level Security.
 *
 * Uses a secret key for authentication, giving full access to all data.
 * Stateless — one client per request.
 *
 * @throws {@link EnvError} If `SUPABASE_URL` is missing or the specified secret key is not found.
 *
 * @example
 * ```ts
 * const supabaseAdmin = createAdminClient()
 * const { data } = await supabaseAdmin.from('audit_log').insert({ action: 'user_login' })
 * ```
 */
export function createAdminClient<Database = unknown>(
  options?: CreateAdminClientOptions,
): SupabaseClient<Database> {
  const { data: resolved, error } = resolveEnv(options?.env)
  if (error) throw error

  const keyName = options?.auth?.keyName
  const supabaseOptions = options?.supabaseOptions

  const name = keyName ?? 'default'
  const keys = resolved.secretKeys
  const secretKey =
    keys[name] ?? (keyName == null ? Object.values(keys)[0] : undefined)
  if (!secretKey) {
    throw name === 'default'
      ? Errors[MissingDefaultSecretKeyError]()
      : Errors[MissingSecretKeyError](name)
  }

  // Sanitize auth headers — only the service-role key controls Authorization and apikey.
  const safeHeaders = { ...supabaseOptions?.global?.headers }
  delete safeHeaders.Authorization
  delete safeHeaders.apikey

  // supabaseOptions uses `string` for schema; createClient<Database> expects a narrower type.
  return createClient<Database>(resolved.url, secretKey, {
    ...supabaseOptions,
    // Stripped — token injection is managed via the service-role key.
    accessToken: undefined,
    global: {
      ...supabaseOptions?.global,
      headers: safeHeaders,
    },
    auth: {
      ...supabaseOptions?.auth,
      persistSession: false,
      autoRefreshToken: false,
      detectSessionInUrl: false,
    },
  } as Parameters<typeof createClient<Database>>[2])
}
