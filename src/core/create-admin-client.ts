import { createClient, type SupabaseClient } from '@supabase/supabase-js'

import type { SupabaseEnv } from '../types.js'
import { resolveEnv } from './resolve-env.js'

export function createAdminClient(env?: Partial<SupabaseEnv>): SupabaseClient {
  const { data: resolved, error } = resolveEnv(env)
  if (error) throw error

  const secretKey = resolved.secretKeys[0]?.key ?? ''

  return createClient(resolved.url, secretKey, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
      detectSessionInUrl: false,
    },
  })
}
