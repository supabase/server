import { createClient, type SupabaseClient } from '@supabase/supabase-js'

import { EnvError } from '../errors.js'
import type { SupabaseEnv } from '../types.js'
import { resolveEnv } from './resolve-env.js'

export function createAdminClient(
  env?: Partial<SupabaseEnv>,
  keyName?: string | null,
): SupabaseClient {
  const { data: resolved, error } = resolveEnv(env)
  if (error) throw error

  const name = keyName ?? 'default'
  const secretKey = resolved.secretKeys[name]
  if (!secretKey) {
    throw new EnvError(
      `No "${name}" secret key found. Set SUPABASE_SECRET_KEY or include a "${name}" entry in SUPABASE_SECRET_KEYS.`,
      'MISSING_SECRET_KEY',
    )
  }

  return createClient(resolved.url, secretKey, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
      detectSessionInUrl: false,
    },
  })
}
