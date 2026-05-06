import {
  AuthError,
  CreateSupabaseClientError,
  EnvError,
  Errors,
} from './errors.js'
import type { SupabaseContext, WithSupabaseConfig } from './types.js'
import { createAdminClient } from './core/create-admin-client.js'
import { createContextClient } from './core/create-context-client.js'
import { verifyAuth } from './core/verify-auth.js'

/**
 * Creates a {@link SupabaseContext} directly from a request.
 *
 * Use this when you need the context without the full {@link withSupabase} wrapper —
 * e.g., inside framework route handlers or custom middleware. Returns a result tuple
 * instead of producing a `Response`.
 *
 * @param request - The incoming HTTP request.
 * @param options - Auth modes, environment overrides. The `cors` option is ignored here.
 * @returns `{ data: SupabaseContext, error: null }` on success, `{ data: null, error: AuthError }` on failure.
 *
 * @example
 * ```ts
 * const { data: ctx, error } = await createSupabaseContext(request, { auth: 'user' })
 * if (error) {
 *   return Response.json({ message: error.message }, { status: error.status })
 * }
 * const { data } = await ctx.supabase.rpc('get_my_items')
 * ```
 */
export async function createSupabaseContext<Database = unknown>(
  request: Request,
  options?: WithSupabaseConfig,
): Promise<
  | { data: SupabaseContext<Database>; error: null }
  | { data: null; error: AuthError }
> {
  const { data: auth, error } = await verifyAuth(request, {
    auth: options?.auth,
    allow: options?.allow,
    env: options?.env,
  })
  if (error) {
    return { data: null, error }
  }

  try {
    const config = {
      env: options?.env,
      supabaseOptions: options?.supabaseOptions,
    }

    const publishableKeyName =
      auth.authType === 'publishable' ? auth.keyName : undefined
    const supabase = createContextClient<Database>({
      auth: { token: auth.token, keyName: publishableKeyName },
      ...config,
    })

    const adminKeyName = auth.authType === 'secret' ? auth.keyName : undefined
    const supabaseAdmin = createAdminClient<Database>({
      auth: { keyName: adminKeyName },
      ...config,
    })

    return {
      data: {
        supabase,
        supabaseAdmin,
        userClaims: auth.userClaims,
        claims: auth.claims,
        authType: auth.authType,
        authKeyName: auth.keyName,
      },
      error: null,
    }
  } catch (e) {
    const error =
      e instanceof EnvError
        ? new AuthError(e.message, e.code, 500)
        : Errors[CreateSupabaseClientError]()
    return { data: null, error }
  }
}
