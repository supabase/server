import { createClient, type SupabaseClient } from '@supabase/supabase-js'

import { EnvError, MissingSecretKeyError } from '../errors.js'
import type { SupabaseEnv } from '../types.js'
import { resolveEnv } from './resolve-env.js'

/**
 * Creates an admin Supabase client that bypasses Row-Level Security.
 *
 * Uses a secret key for authentication, giving full access to all data.
 * Session persistence is disabled (stateless, one client per request).
 *
 * @param env - Optional environment overrides (passed through to {@link resolveEnv}).
 * @param keyName - Name of the secret key to use. Falls back to `"default"`, then first available.
 * @returns A configured {@link SupabaseClient} with admin (service-role) privileges.
 * @throws {@link EnvError} If `SUPABASE_URL` is missing or the specified secret key is not found.
 *
 * @example
 * ```ts
 * const supabaseAdmin = createAdminClient()
 * const { data } = await supabaseAdmin.from('audit_log').insert({ action: 'user_login' })
 * ```
 */
export function createAdminClient<Database = unknown>(
  env?: Partial<SupabaseEnv>,
  keyName?: string | null,
): SupabaseClient<Database> {
  const { data: resolved, error } = resolveEnv(env)
  if (error) throw error

  const name = keyName ?? 'default'
  const keys = resolved.secretKeys
  const secretKey =
    keys[name] ?? (keyName == null ? Object.values(keys)[0] : undefined)
  if (!secretKey) {
    const msg =
      name === 'default'
        ? 'No default secret key found. Set SUPABASE_SECRET_KEY or include a "default" entry in SUPABASE_SECRET_KEYS.'
        : `No "${name}" secret key found. Include a "${name}" entry in SUPABASE_SECRET_KEYS.`
    throw new EnvError(msg, MissingSecretKeyError)
  }

  return createClient(resolved.url, secretKey, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
      detectSessionInUrl: false,
    },
  })
}
