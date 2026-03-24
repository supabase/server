import { createClient, type SupabaseClient } from '@supabase/supabase-js'

import { EnvError } from '../errors.js'
import type { SupabaseEnv } from '../types.js'
import { resolveEnv } from './resolve-env.js'

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
