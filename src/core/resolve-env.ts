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
 * Parses an inline JWKS JSON string. Accepts `{ keys: [...] }` or a bare
 * array `[...]` (wrapped as `{ keys: [...] }`). Returns `null` for missing
 * or malformed input.
 *
 * @internal
 */
function parseJwks(raw: string | undefined): JsonWebKeySet | null {
  if (!raw) return null
  try {
    const parsed = JSON.parse(raw)
    if (Array.isArray(parsed)) return { keys: parsed }
    if (parsed?.keys && Array.isArray(parsed.keys))
      return parsed as JsonWebKeySet
    return null
  } catch {
    return null
  }
}

/**
 * Returns true if the hostname is a loopback address — `localhost`,
 * `*.localhost`, `127.0.0.0/8`, or `::1`. Browsers treat these as secure
 * contexts because traffic never leaves the machine.
 *
 * @internal
 */
function isLoopbackHost(hostname: string): boolean {
  if (hostname === 'localhost' || hostname.endsWith('.localhost')) return true
  // URL.hostname keeps the brackets for IPv6 literals (e.g. "[::1]").
  if (hostname === '[::1]') return true
  if (/^127\.\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(hostname)) return true
  return false
}

/**
 * Parses a JWKS endpoint URL. `https://` is always accepted. Plain `http://`
 * is accepted only for loopback hosts (`localhost`, `127.0.0.0/8`, `::1`) so
 * the Supabase CLI flow works against `http://localhost:54321`. For any
 * other host, http is rejected: a MITM on the JWKS fetch could swap in an
 * attacker-controlled key and forge JWTs that pass verification. Returns
 * `null` for missing or malformed input.
 *
 * @internal
 */
function parseJwksUrl(raw: string | undefined): URL | null {
  if (!raw) return null
  const trimmed = raw.trim()
  try {
    const url = new URL(trimmed)
    if (url.protocol === 'https:') return url
    if (url.protocol === 'http:' && isLoopbackHost(url.hostname)) return url
    return null
  } catch {
    return null
  }
}

/**
 * Resolves the JWKS source from `SUPABASE_JWKS` (inline JSON) or
 * `SUPABASE_JWKS_URL` (https endpoint). `SUPABASE_JWKS` wins when set;
 * `SUPABASE_JWKS_URL` is only consulted if `SUPABASE_JWKS` is absent. Each
 * variable is treated as authoritative — if set but malformed, the result is
 * `null` and the other variable is *not* consulted as a fallback.
 *
 * @internal
 */
function resolveJwks(): JsonWebKeySet | URL | null {
  const rawJwks = getEnvVar('SUPABASE_JWKS')
  if (rawJwks && rawJwks.trim()) {
    return parseJwks(rawJwks)
  }
  const rawJwksUrl = getEnvVar('SUPABASE_JWKS_URL')
  if (rawJwksUrl && rawJwksUrl.trim()) {
    return parseJwksUrl(rawJwksUrl)
  }
  return null
}

/**
 * Resolves Supabase environment configuration from runtime environment variables.
 *
 * Reads `SUPABASE_URL`, keys (`SUPABASE_PUBLISHABLE_KEYS` / `SUPABASE_SECRET_KEYS`),
 * and the JWKS source (`SUPABASE_JWKS` for inline keys, or `SUPABASE_JWKS_URL`
 * for a remote endpoint). Works across Deno, Node.js, and Bun. For Cloudflare
 * Workers, use `overrides` or enable node-compat.
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
    jwks: overrides?.jwks ?? resolveJwks(),
    audience: overrides?.audience ?? getEnvVar('SUPABASE_JWT_AUDIENCE'),
    issuer: overrides?.issuer ?? getEnvVar('SUPABASE_JWT_ISSUER'),
  }

  return { data, error: null }
}
