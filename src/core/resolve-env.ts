import { EnvError, Errors, MissingSupabaseURLError } from '../errors.js'
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
 * Parses a `SUPABASE_JWKS` env value.
 *
 * Accepted forms:
 * - An `https://` URL — returned as a {@link URL}; keys are fetched at verify time.
 *   Plain `http://` is rejected: a MITM on the JWKS fetch could swap in an
 *   attacker-controlled key and forge JWTs that pass verification.
 * - JSON `{ keys: [...] }` — returned as a {@link JsonWebKeySet}.
 * - JSON bare array `[...]` — wrapped as `{ keys: [...] }`.
 * - Anything else (missing or malformed) — returns `null`.
 *
 * @internal
 */
function parseJwks(raw: string | undefined): JsonWebKeySet | URL | null {
  if (!raw) return null
  const trimmed = raw.trim()
  if (trimmed.startsWith('https://')) {
    try {
      return new URL(trimmed)
    } catch {
      return null
    }
  }
  try {
    const parsed = JSON.parse(trimmed)
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
      error: Errors[MissingSupabaseURLError](),
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
