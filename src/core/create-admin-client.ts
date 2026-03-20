import { createClient, type SupabaseClient } from '@supabase/supabase-js'

import { EnvError } from '../errors.js'
import type { SupabaseEnv } from '../types.js'
import { resolveEnv } from './resolve-env.js'

export function createAdminClient(env?: Partial<SupabaseEnv>): SupabaseClient {
  const { data: resolved, error } = resolveEnv(env)
  if (error) throw error

  const secretKey = resolved.secretKeys['default']
  if (!secretKey) {
    throw new EnvError(
      'No default secret key found. Set SUPABASE_SECRET_KEY or include a "default" entry in SUPABASE_SECRET_KEYS.',
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
