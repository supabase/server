import type { JWTClaims } from '../../dist/index.mjs'

/** The caller identity shape every app returns from `/me` and `/me-optional`. */
export interface UserClaimsView {
  id: string
  email?: string
  role?: string
}

/**
 * Rebuilds the `userClaims` view from the raw JWT payload.
 *
 * No middleware entry contributes `userClaims`. `withClaims` and
 * `withRequiredClaims` both contribute `jwtClaims`, the raw JWT payload, and
 * the field names differ — `sub` carries what `userClaims.id` carried. Each
 * app rewrites the fields here rather than renaming the binding, which is the
 * same per-field rewrite the frameworks guide asks consumers to do:
 * https://supabase.com/docs/reference/server/frameworks
 */
export function toUserClaims(claims: JWTClaims | null): UserClaimsView | null {
  if (!claims) return null
  return { id: claims.sub, email: claims.email, role: claims.role }
}
