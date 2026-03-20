import { AuthError, EnvError } from './errors.js'
import type { SupabaseContext, WithSupabaseConfig } from './types.js'
import { createAdminClient } from './core/create-admin-client.js'
import { createContextClient } from './core/create-context-client.js'
import { verifyAuth } from './core/verify-auth.js'

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

  try {
    const supabase = createContextClient(auth.token, options?.env, auth.keyName)
    const adminKeyName = auth.authType === 'secret' ? auth.keyName : undefined
    const supabaseAdmin = createAdminClient(options?.env, adminKeyName)

    return {
      data: {
        supabase,
        supabaseAdmin,
        userClaims: auth.userClaims,
        claims: auth.claims,
        authType: auth.authType,
      },
      error: null,
    }
  } catch (e) {
    const error =
      e instanceof EnvError
        ? new AuthError(e.message, e.code, 500)
        : new AuthError('Failed to create Supabase client', 'CLIENT_ERROR', 500)
    return { data: null, error }
  }
}
