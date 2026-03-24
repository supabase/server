import { EnvError } from '../errors.js'
import type { JsonWebKeySet, SupabaseEnv } from '../types.js'

/**
 * Reads an environment variable from the current runtime (Deno, Node.js, Bun, or Workers).
 * @internal
 */
function getEnvVar(name: string): string | undefined {
  // Deno runtime
  if (typeof Deno !== 'undefined' && Deno.env?.get) {
    return Deno.env.get(name)
  }
  // Node.js / Workers / Bun
  if (typeof process !== 'undefined' && process.env) {
    return process.env[name]
  }
  return undefined
}

/**
 * Parses a JSON string into a `Record<string, string>` key map.
 * Returns an empty object if the input is missing, malformed, or not a plain object.
 * @internal
 */
function parseKeys(raw: string | undefined): Record<string, string> {
  if (!raw) return {}
  try {
    const parsed = JSON.parse(raw)
    if (
      typeof parsed !== 'object' ||
      parsed === null ||
      Array.isArray(parsed)
    ) {
      return {}
    }
    return parsed as Record<string, string>
  } catch {
    return {}
  }
}

/**
 * Resolves API keys from environment variables. Checks the plural form first
 * (`SUPABASE_PUBLISHABLE_KEYS` as JSON), then falls back to the singular form
 * (`SUPABASE_PUBLISHABLE_KEY` stored as `{ default: "<value>" }`).
 * @internal
 */
function resolveKeys(
  singularVar: string,
  pluralVar: string,
): Record<string, string> {
  const plural = getEnvVar(pluralVar)
  if (plural) return parseKeys(plural)
  const singular = getEnvVar(singularVar)
  if (singular) return { default: singular }
  return {}
}

/**
 * Parses a JWKS JSON string into a {@link JsonWebKeySet}.
 * Accepts both `{ keys: [...] }` and bare `[...]` array formats.
 * Returns `null` if the input is missing or malformed.
 * @internal
 */
function parseJwks(raw: string | undefined): JsonWebKeySet | null {
  if (!raw) return null
  try {
    const parsed = JSON.parse(raw)
    // Support both { keys: [...] } and bare array [...] formats
    if (Array.isArray(parsed)) return { keys: parsed }
    if (parsed?.keys && Array.isArray(parsed.keys))
      return parsed as JsonWebKeySet
    return null
  } catch {
    return null
  }
}

/**
 * Resolves the Supabase environment configuration from environment variables.
 *
 * Reads from the following environment variables (works across Deno, Node.js, Bun,
 * and Cloudflare Workers):
 *
 * | Variable                    | Required | Format                                |
 * | --------------------------- | -------- | ------------------------------------- |
 * | `SUPABASE_URL`              | Yes      | `"https://<ref>.supabase.co"`         |
 * | `SUPABASE_PUBLISHABLE_KEYS` | No       | JSON object: `{ "default": "..." }`   |
 * | `SUPABASE_PUBLISHABLE_KEY`  | No       | Single key string (fallback)          |
 * | `SUPABASE_SECRET_KEYS`      | No       | JSON object: `{ "default": "..." }`   |
 * | `SUPABASE_SECRET_KEY`       | No       | Single key string (fallback)          |
 * | `SUPABASE_JWKS`             | No       | JSON — `{ keys: [...] }` or `[...]`   |
 *
 * @param overrides - Partial environment values that take precedence over env vars.
 *   Useful for testing or when env vars aren't available.
 *
 * @returns A result tuple: `{ data, error }`.
 *   - On success: `{ data: SupabaseEnv, error: null }`
 *   - On failure: `{ data: null, error: EnvError }` (currently only when `SUPABASE_URL` is missing)
 *
 * @example
 * ```ts
 * import { resolveEnv } from '@supabase/server/core'
 *
 * // Auto-detect from environment
 * const { data: env, error } = resolveEnv()
 * if (error) throw error
 * console.log(env.url) // "https://abc123.supabase.co"
 *
 * // Override specific values (e.g., in tests)
 * const { data: env } = resolveEnv({
 *   url: 'http://localhost:54321',
 *   secretKeys: { default: 'test-secret-key' },
 * })
 * ```
 */
export function resolveEnv(
  overrides?: Partial<SupabaseEnv>,
): { data: SupabaseEnv; error: null } | { data: null; error: EnvError } {
  const url = overrides?.url ?? getEnvVar('SUPABASE_URL')

  if (!url) {
    return {
      data: null,
      error: new EnvError(
        'SUPABASE_URL is required but not set',
        'MISSING_SUPABASE_URL',
      ),
    }
  }

  const data: SupabaseEnv = {
    url,
    publishableKeys:
      overrides?.publishableKeys ??
      resolveKeys('SUPABASE_PUBLISHABLE_KEY', 'SUPABASE_PUBLISHABLE_KEYS'),
    secretKeys:
      overrides?.secretKeys ??
      resolveKeys('SUPABASE_SECRET_KEY', 'SUPABASE_SECRET_KEYS'),
    jwks: overrides?.jwks ?? parseJwks(getEnvVar('SUPABASE_JWKS')),
  }

  return { data, error: null }
}
