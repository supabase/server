import { createClient, type SupabaseClient } from '@supabase/supabase-js'

import { EnvError } from '../errors.js'
import type { SupabaseEnv } from '../types.js'
import { resolveEnv } from './resolve-env.js'

/**
 * Creates a Supabase client scoped to the caller's context.
 *
 * The client is configured with a publishable key and (optionally) the caller's
 * JWT as a Bearer token. This means Row-Level Security policies apply — the client
 * can only access data the caller is authorized to see.
 *
 * Session persistence is disabled since this is designed for stateless
 * server-side use (one client per request).
 *
 * @param token - The caller's JWT. When provided, it's set as the `Authorization`
 *   header on every request to Supabase. Pass `null` for anonymous access.
 * @param env - Optional environment overrides (passed through to {@link resolveEnv}).
 * @param keyName - Name of the publishable key to use (e.g. `"default"`, `"mobile"`).
 *   Falls back to `"default"`, then to the first available key.
 *
 * @returns A configured {@link SupabaseClient} with RLS enforced.
 *
 * @throws {@link EnvError} If `SUPABASE_URL` is missing or the specified publishable key is not found.
 *
 * @example
 * ```ts
 * import { createContextClient, verifyAuth } from '@supabase/server/core'
 *
 * const { data: auth } = await verifyAuth(request, { allow: 'user' })
 * const supabase = createContextClient(auth.token)
 *
 * // RLS policies apply — only returns rows the user can access
 * const { data } = await supabase.rpc('get_my_items')
 * ```
 */
export function createContextClient(
  token?: string | null,
  env?: Partial<SupabaseEnv>,
  keyName?: string | null,
): SupabaseClient {
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
    throw new EnvError(msg, 'MISSING_PUBLISHABLE_KEY')
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
