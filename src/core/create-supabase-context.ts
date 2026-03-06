import type { AuthError } from '../errors.js'
import type { SupabaseContext, WithSupabaseConfig } from '../types.js'
import { createAdminClient } from './create-admin-client.js'
import { createContextClient } from './create-context-client.js'
import { verifyAuth } from './verify-auth.js'

export async function createSupabaseContext(
  request: Request,
  options?: WithSupabaseConfig,
): Promise<
  { data: SupabaseContext; error: null } | { data: null; error: AuthError }
> {
  const allow = options?.allow ?? 'user'

  const { data: auth, error } = await verifyAuth(request, {
    allow,
    env: options?.env,
  })
  if (error) {
    return { data: null, error }
  }

  const supabase = createContextClient(auth.token, options?.env)
  const supabaseAdmin = createAdminClient(options?.env)

  return {
    data: {
      supabase,
      supabaseAdmin,
      user: auth.user,
      claims: auth.claims,
      authType: auth.authType,
    },
    error: null,
  }
}
