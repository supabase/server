import { EnvError, MissingSupabaseURLError } from '../errors.js'
import type { JsonWebKeySet, SupabaseEnv } from '../types.js'

/**
 * Reads an environment variable from the current runtime (Deno, Node.js, or Bun).
 * Cloudflare Workers require node-compat or passing values via `overrides`.
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
 * Resolves Supabase environment configuration from runtime environment variables.
 *
 * Reads `SUPABASE_URL`, keys (`SUPABASE_PUBLISHABLE_KEYS` / `SUPABASE_SECRET_KEYS`),
 * and `SUPABASE_JWKS`. Works across Deno, Node.js, and Bun. For Cloudflare Workers,
 * use `overrides` or enable node-compat.
 *
 * @param overrides - Partial values that take precedence over env vars.
 * @returns `{ data: SupabaseEnv, error: null }` on success, `{ data: null, error: EnvError }` on failure.
 *
 * @example
 * ```ts
 * const { data: env, error } = resolveEnv()
 * if (error) throw error
 *
 * // Override for tests
 * const { data: env } = resolveEnv({ url: 'http://localhost:54321' })
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
        MissingSupabaseURLError,
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
