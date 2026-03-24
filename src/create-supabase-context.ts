import { AuthError, EnvError } from './errors.js'
import type { SupabaseContext, WithSupabaseConfig } from './types.js'
import { createAdminClient } from './core/create-admin-client.js'
import { createContextClient } from './core/create-context-client.js'
import { verifyAuth } from './core/verify-auth.js'

/**
 * Creates a {@link SupabaseContext} directly from a request.
 *
 * Use this when you need the Supabase context without the full {@link withSupabase}
 * wrapper — for example, inside framework route handlers, custom middleware, or
 * test setups where you want explicit control over error handling.
 *
 * Performs the same auth + client creation as `withSupabase`, but returns a
 * result tuple instead of producing a `Response`. You handle errors yourself.
 *
 * @param request - The incoming HTTP request.
 * @param options - Configuration for auth modes, environment overrides, and CORS.
 *   The `cors` option is ignored here (only relevant in {@link withSupabase}).
 *
 * @returns A result tuple: `{ data, error }`.
 *   - On success: `{ data: SupabaseContext, error: null }`
 *   - On failure: `{ data: null, error: AuthError }` with an appropriate status code
 *
 * @example Basic usage
 * ```ts
 * import { createSupabaseContext } from '@supabase/edge-functions'
 *
 * const { data: ctx, error } = await createSupabaseContext(request, {
 *   allow: 'user',
 * })
 *
 * if (error) {
 *   return Response.json(
 *     { error: error.message, code: error.code },
 *     { status: error.status },
 *   )
 * }
 *
 * // ctx.supabase, ctx.supabaseAdmin, ctx.userClaims are ready
 * const { data } = await ctx.supabase.rpc('get_my_items')
 * ```
 *
 * @example Inside a framework route handler (e.g., SvelteKit)
 * ```ts
 * export async function GET({ request }) {
 *   const { data: ctx, error } = await createSupabaseContext(request, {
 *     allow: 'user',
 *   })
 *   if (error) {
 *     return new Response(error.message, { status: error.status })
 *   }
 *   const { data } = await ctx.supabase.rpc('get_user_settings')
 *   return Response.json(data)
 * }
 * ```
 */
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
