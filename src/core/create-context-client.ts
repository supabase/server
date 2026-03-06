import { createClient, type SupabaseClient } from '@supabase/supabase-js'

import type { SupabaseEnv } from '../types.js'
import { resolveEnv } from './resolve-env.js'

export function createContextClient(
  token?: string | null,
  env?: Partial<SupabaseEnv>,
): SupabaseClient {
  const { data: resolved, error } = resolveEnv(env)
  if (error) throw error

  const anonKey = resolved.publishableKeys[0]?.key ?? ''

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
