import { getEnv, runtimeName } from '@supabase/middleware'

/**
 * Whether this request is being served by Supabase Edge Functions.
 *
 * Gates the request-derived URL defaults. The Edge Functions gateway sets
 * `X-Forwarded-*` to the project's externally-visible origin and strips the
 * `/functions/v1` prefix; off platform those headers describe the app's own
 * origin, which is unrelated to the Supabase project.
 *
 * True when `SUPABASE_FUNCTION_SLUG` is set, or when the host runtime is Deno.
 * A plain Deno server or Deno Deploy therefore reads as Edge Functions.
 *
 * @internal
 */
export function isEdgeFunctions(): boolean {
  if (getEnv('SUPABASE_FUNCTION_SLUG')) return true
  return runtimeName === 'deno'
}
