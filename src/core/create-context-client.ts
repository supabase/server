import { createClient, type SupabaseClient } from '@supabase/supabase-js'

import { EnvError } from '../errors.js'
import type { SupabaseEnv } from '../types.js'
import { resolveEnv } from './resolve-env.js'

export function createContextClient<Database = any>(
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
