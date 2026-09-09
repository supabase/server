import { getEnv, runtimeName } from '@supabase/middleware'

/**
 * Whether this request is being served by Supabase Edge Functions.
 *
 * Gates the request-derived URL defaults. The Edge Functions gateway sets
 * `X-Forwarded-*` to the project's externally-visible origin and strips the
 * `/functions/v1` prefix; off platform those headers describe the app's own
 * origin, which is unrelated to the Supabase project.
 *
 * True when `SUPABASE_FUNCTION_SLUG` or `SB_EXECUTION_ID` is set, or when the
 * host runtime is Deno. A plain Deno server or Deno Deploy therefore reads as
 * Edge Functions.
 *
 * The runtime name alone cannot identify Supabase's edge runtime: it exposes an
 * `EdgeRuntime` global, which std-env classifies as `edge-light` before it
 * checks for Deno. `SB_EXECUTION_ID` is set by the edge runtime itself for
 * every invocation, hosted and local, so it is the marker that holds when the
 * gateway does not inject a slug.
 *
 * @internal
 */
export function isEdgeFunctions(): boolean {
  if (getEnv('SUPABASE_FUNCTION_SLUG')) return true
  if (getEnv('SB_EXECUTION_ID')) return true
  return runtimeName === 'deno'
}
