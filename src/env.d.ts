/* eslint-disable no-var */

/**
 * Deno runtime global. Present when running in Supabase Edge Functions
 * or any Deno environment. Used by {@link resolveEnv} to read environment variables.
 */
declare var Deno:
  | {
      env: {
        get(key: string): string | undefined
      }
    }
  | undefined

/**
 * Node.js / Bun / Cloudflare Workers global. Used by {@link resolveEnv}
 * as a fallback when the Deno global is not available.
 */
declare var process:
  | {
      env: Record<string, string | undefined>
    }
  | undefined
