import { createClient, type SupabaseClient } from '@supabase/supabase-js'

import { EnvError, MissingPublishableKeyError } from '../errors.js'
import type { SupabaseEnv } from '../types.js'
import { resolveEnv } from './resolve-env.js'

/**
 * Creates a Supabase client scoped to the caller's context.
 *
 * Configured with a publishable key and (optionally) the caller's JWT,
 * so Row-Level Security policies apply. Session persistence is disabled
 * (stateless, one client per request).
 *
 * @param token - The caller's JWT, or `null` for anonymous access.
 * @param env - Optional environment overrides (passed through to {@link resolveEnv}).
 * @param keyName - Name of the publishable key to use. Falls back to `"default"`, then first available.
 * @returns A configured {@link SupabaseClient} with RLS enforced.
 * @throws {@link EnvError} If `SUPABASE_URL` is missing or the specified publishable key is not found.
 *
 * @example
 * ```ts
 * const { data: auth } = await verifyAuth(request, { allow: 'user' })
 * const supabase = createContextClient(auth.token)
 * const { data } = await supabase.rpc('get_my_items')
 * ```
 */
export function createContextClient<Database = unknown>(
  token?: string | null,
  env?: Partial<SupabaseEnv>,
  keyName?: string | null,
): SupabaseClient<Database> {
  const { data: resolved, error } = resolveEnv(env)
  if (error) throw error

  const name = keyName ?? 'default'
  const keys = resolved.publishableKeys
  const anonKey =
    keys[name] ?? (keyName == null ? Object.values(keys)[0] : undefined)
  if (!anonKey) {
    const msg =
      name === 'default'
        ? 'No default publishable key found. Set SUPABASE_PUBLISHABLE_KEY or include a "default" entry in SUPABASE_PUBLISHABLE_KEYS.'
        : `No "${name}" publishable key found. Include a "${name}" entry in SUPABASE_PUBLISHABLE_KEYS.`
    throw new EnvError(msg, MissingPublishableKeyError)
  }

  return createClient(resolved.url, anonKey, {
    global: {
      headers: token ? { Authorization: `Bearer ${token}` } : {},
    },
    auth: {
      persistSession: false,
      autoRefreshToken: false,
      detectSessionInUrl: false,
    },
  })
}
