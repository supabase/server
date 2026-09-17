import type { JSONWebKeySet } from 'jose'

import { EnvError, Errors, MissingSupabaseURLError } from '../errors.js'
import type { SupabaseEnv } from '../types.js'

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
function parseJwks(raw: string | undefined): JSONWebKeySet | null {
  if (!raw) return null
  try {
    const parsed = JSON.parse(raw)
    if (Array.isArray(parsed)) return { keys: parsed }
    if (parsed?.keys && Array.isArray(parsed.keys))
      return parsed as JSONWebKeySet
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
 * `SUPABASE_JWKS_URL` (https endpoint), falling back to the project's
 * well-known JWKS endpoint derived from the project URL. `SUPABASE_JWKS` wins
 * when set; `SUPABASE_JWKS_URL` is only consulted if `SUPABASE_JWKS` is
 * absent; the derived URL only when both are absent. Each variable is treated
 * as authoritative — if set but malformed, the result is `null` and neither
 * the other variable nor the derived URL is consulted as a fallback.
 *
 * The derivation reads `SUPABASE_PUBLIC_URL` first, then `supabaseUrl` (the
 * URL {@link resolveEnv} already resolved, so an `overrides.url` reaches the
 * derivation), then `SUPABASE_URL`. This is the same order
 * `defaultAuthorizationServer` uses for the OAuth issuer: on self-hosted
 * stacks `SUPABASE_URL` is the Docker-internal gateway (`http://kong:8000`)
 * and `SUPABASE_PUBLIC_URL` carries the externally reachable domain.
 *
 * @param supabaseUrl - The already-resolved project URL, if the caller has one.
 *
 * @internal
 */
export function resolveJwks(supabaseUrl?: string): JSONWebKeySet | URL | null {
  const rawJwks = getEnvVar('SUPABASE_JWKS')
  if (rawJwks && rawJwks.trim()) {
    return parseJwks(rawJwks)
  }
  const rawJwksUrl = getEnvVar('SUPABASE_JWKS_URL')
  if (rawJwksUrl && rawJwksUrl.trim()) {
    return parseJwksUrl(rawJwksUrl)
  }
  const publicUrl = getEnvVar('SUPABASE_PUBLIC_URL')
  if (publicUrl && publicUrl.trim()) {
    return deriveJwksUrl(publicUrl)
  }
  return deriveJwksUrl(supabaseUrl ?? getEnvVar('SUPABASE_URL'))
}

/**
 * Derives the project's JWKS endpoint from a project URL when neither
 * `SUPABASE_JWKS` nor `SUPABASE_JWKS_URL` is set. Every Supabase project
 * publishes its signing keys at `{url}/auth/v1/.well-known/jwks.json`, so
 * `auth: 'user'` works with only `SUPABASE_URL` configured, as it already does
 * on Edge Functions where the JWKS is injected.
 *
 * The same transport rule as `SUPABASE_JWKS_URL` applies: https, or http on
 * a loopback host. A Docker-internal URL such as `http://kong:8000` yields
 * `null`, so a token cannot be verified against keys fetched over a
 * non-loopback plaintext hop. Self-hosted stacks set `SUPABASE_PUBLIC_URL`
 * to the external domain, which {@link resolveJwks} prefers for exactly this
 * reason.
 *
 * @internal
 */
export function deriveJwksUrl(rawUrl: string | undefined): URL | null {
  if (!rawUrl || !rawUrl.trim()) return null
  try {
    const base = new URL(rawUrl.trim())
    base.pathname =
      base.pathname.replace(/\/+$/, '') + '/auth/v1/.well-known/jwks.json'
    base.search = ''
    base.hash = ''
    return parseJwksUrl(base.href)
  } catch {
    return null
  }
}

/**
 * Resolves Supabase environment configuration from runtime environment variables.
 *
 * Reads `SUPABASE_URL`, keys (`SUPABASE_PUBLISHABLE_KEYS` / `SUPABASE_SECRET_KEYS`),
 * and the JWKS source (`SUPABASE_JWKS` for inline keys, `SUPABASE_JWKS_URL`
 * for a remote endpoint, or the well-known endpoint derived from
 * `SUPABASE_PUBLIC_URL` / the resolved `url`). Works across Deno, Node.js,
 * and Bun. For Cloudflare Workers, use `overrides` or enable node-compat.
 *
 * @param overrides - Partial values that take precedence over env vars.
 * @returns `{ data: SupabaseEnv, error: null }` on success, `{ data: null, error: EnvError }` on failure.
 *
 * @example Reading and overriding env vars
 * ```ts
 * const { data: env, error } = resolveEnv()
 * if (error) throw error
 *
 * // Override for tests
 * const { data: env } = resolveEnv({ url: 'http://localhost:54321' })
 * ```
 *
 * @category Primitives
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
    jwks: overrides?.jwks ?? resolveJwks(url),
  }

  return { data, error: null }
}
