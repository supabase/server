import { createClient, type SupabaseClient } from '@supabase/supabase-js'

import {
  Errors,
  MissingDefaultPublishableKeyError,
  MissingPublishableKeyError,
} from '../errors.js'
import type { CreateContextClientOptions } from '../types.js'
import { resolveEnv } from './resolve-env.js'

/**
 * Creates a Supabase client scoped to the caller's context.
 *
 * Configured with a publishable key and (optionally) the caller's JWT,
 * so Row-Level Security policies apply. Stateless — one client per request.
 *
 * @throws {@link EnvError} If `SUPABASE_URL` is missing or the specified publishable key is not found.
 *
 * @example
 * ```ts
 * const { data: auth } = await verifyAuth(request, { allow: 'user' })
 * const supabase = createContextClient({
 *   auth: { token: auth.token, keyName: auth.keyName },
 * })
 * const { data } = await supabase.rpc('get_my_items')
 * ```
 */
export function createContextClient<Database = unknown>(
  options?: CreateContextClientOptions,
): SupabaseClient<Database> {
  const { data: resolved, error } = resolveEnv(options?.env)
  if (error) throw error

  const token = options?.auth?.token
  const keyName = options?.auth?.keyName
  const supabaseOptions = options?.supabaseOptions

  const name = keyName ?? 'default'
  const keys = resolved.publishableKeys
  const anonKey =
    keys[name] ?? (keyName == null ? Object.values(keys)[0] : undefined)
  if (!anonKey) {
    throw name === 'default'
      ? Errors[MissingDefaultPublishableKeyError]()
      : Errors[MissingPublishableKeyError](name)
  }

  // supabaseOptions uses `string` for schema; createClient<Database> expects a narrower type.
  return createClient<Database>(resolved.url, anonKey, {
    ...supabaseOptions,
    // Stripped — token injection is managed via the Authorization header from verified credentials.
    accessToken: undefined,
    global: {
      ...supabaseOptions?.global,
      headers: {
        ...supabaseOptions?.global?.headers,
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
    },
    auth: {
      ...supabaseOptions?.auth,
      persistSession: false,
      autoRefreshToken: false,
      detectSessionInUrl: false,
    },
  } as Parameters<typeof createClient<Database>>[2])
}
