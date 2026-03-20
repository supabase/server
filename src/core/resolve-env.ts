import { EnvError } from '../errors.js'
import type { JsonWebKeySet, SupabaseEnv } from '../types.js'

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

function parseJwks(raw: string | undefined): JsonWebKeySet | null {
  if (!raw) return null
  try {
    const parsed = JSON.parse(raw)
    // Support both { keys: [...] } and bare array [...] formats
    if (Array.isArray(parsed)) return { keys: parsed }
    return parsed as JsonWebKeySet
  } catch {
    return null
  }
}

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
