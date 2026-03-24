import { createClient, type SupabaseClient } from '@supabase/supabase-js'

import { EnvError } from '../errors.js'
import type { SupabaseEnv } from '../types.js'
import { resolveEnv } from './resolve-env.js'

/**
 * Creates an admin Supabase client that bypasses Row-Level Security.
 *
 * Uses a secret key for authentication, giving full access to all data.
 * Use this for operations that legitimately require elevated privileges,
 * such as writing audit logs, managing user data, or cross-tenant queries.
 *
 * Session persistence is disabled since this is designed for stateless
 * server-side use (one client per request).
 *
 * **Security note:** This client bypasses RLS entirely. Never expose it to
 * end users or use it for operations that should respect user permissions.
 *
 * @param env - Optional environment overrides (passed through to {@link resolveEnv}).
 * @param keyName - Name of the secret key to use (e.g. `"default"`).
 *   Falls back to `"default"`, then to the first available key.
 *
 * @returns A configured {@link SupabaseClient} with admin (service-role) privileges.
 *
 * @throws {@link EnvError} If `SUPABASE_URL` is missing or the specified secret key is not found.
 *
 * @example
 * ```ts
 * import { createAdminClient } from '@supabase/edge-functions/core'
 *
 * const supabaseAdmin = createAdminClient()
 *
 * // Bypasses RLS — use with care
 * const { data } = await supabaseAdmin
 *   .from('audit_log')
 *   .insert({ action: 'user_login', user_id: userId })
 * ```
 */
export function createAdminClient(
  env?: Partial<SupabaseEnv>,
  keyName?: string | null,
): SupabaseClient {
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
    throw new EnvError(msg, 'MISSING_SECRET_KEY')
  }

  return createClient(resolved.url, secretKey, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
      detectSessionInUrl: false,
    },
  })
}
