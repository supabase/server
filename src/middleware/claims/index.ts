import { defineMiddleware } from '@supabase/middleware'
import type { Middleware } from '@supabase/middleware'

/**
 * Loosely-typed JWT claims contributed by {@link withClaims}.
 *
 * @category Middleware
 */
export interface JwtClaims {
  sub?: string
  role?: string
  [k: string]: unknown
}

/** base64url-decode a JWT payload segment (no signature verification). */
function decodeJwtPayload(token: string): JwtClaims | null {
  const part = token.split('.')[1]
  if (!part) return null
  const b64 = part
    .replace(/-/g, '+')
    .replace(/_/g, '/')
    .padEnd(Math.ceil(part.length / 4) * 4, '=')
  try {
    return JSON.parse(atob(b64)) as JwtClaims
  } catch {
    return null
  }
}

/**
 * Contributes `ctx.jwtClaims` by decoding the caller's Bearer token.
 *
 * Use this only when composing a standalone `pipeline([...], handler)` that is
 * **not** wrapped by `withSupabase` — for example a Supabase-agnostic Edge
 * Function that still wants the caller's claims available to a downstream
 * middleware such as {@link withPostgres}. Inside `withSupabase`, the context
 * already carries `jwtClaims` (JWKS-verified), so `withClaims` is unnecessary.
 *
 * > **DEMO ONLY — does NOT verify the signature.** It base64url-decodes the
 * > payload so the Postgres example is self-contained. `withSupabase` verifies
 * > the JWT against the project JWKS before trusting the claims; never trust an
 * > unverified token in production.
 *
 * @category Middleware
 */
export const withClaims: Middleware<
  'jwtClaims',
  void,
  Record<never, never>,
  JwtClaims | null
> = defineMiddleware<'jwtClaims', void, Record<never, never>, JwtClaims | null>(
  {
    key: 'jwtClaims',
    run: () => async (req) => {
      const auth = req.headers.get('Authorization')
      const token = auth?.replace(/^Bearer\s+/i, '')
      return { jwtClaims: token ? decodeJwtPayload(token) : null }
    },
  },
)
