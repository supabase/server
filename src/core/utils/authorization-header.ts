/**
 * What the `Authorization` header carried, from the perspective of a layer that
 * needs a user JWT out of it.
 *
 * @internal
 */
export type AuthorizationDiagnosis =
  /** No `Authorization` header at all. */
  | { kind: 'absent' }
  /** A bearer token that is not an `sb_*` API key — a JWT candidate. */
  | { kind: 'bearer' }
  /** An `sb_*` API key, which the Supabase SDK forwards here too. */
  | { kind: 'api-key' }
  /** Present, but no bearer token could be read out of it. */
  | { kind: 'unreadable'; reason: string; hint: string }

/**
 * Classifies the raw `Authorization` header.
 *
 * {@link extractCredentials} only reads `Authorization: Bearer <token>`, so a
 * wrong scheme, wrong casing, or a bare token silently produces no credential —
 * which reads to the caller as "you sent nothing", the single most confusing way
 * for auth to fail. This is the one place that distinction is worked out, so
 * `verifyAuth` and the `withRequiredClaims` gate report an identical request
 * identically.
 *
 * @param raw - The header value, or `null` when absent.
 *
 * @internal
 */
export function diagnoseAuthorizationHeader(
  raw: string | null,
): AuthorizationDiagnosis {
  if (!raw) return { kind: 'absent' }

  const [scheme = '', ...rest] = raw.split(' ')

  if (scheme === 'Bearer') {
    const token = rest.join(' ').trim()
    // Header values are trimmed in transit, so a trailing-space-only value
    // arrives here as a bare "Bearer".
    if (!token) {
      return {
        kind: 'unreadable',
        reason:
          'the Authorization header used the `Bearer` scheme but carried an empty token',
        hint: 'Put the JWT after `Bearer `, separated by a single space.',
      }
    }
    // `sb_*` secrets ride this header alongside the apikey header; they are API
    // keys, not user JWTs.
    return token.startsWith('sb_') ? { kind: 'api-key' } : { kind: 'bearer' }
  }

  if (scheme.toLowerCase() === 'bearer') {
    return {
      kind: 'unreadable',
      reason: `the Authorization header used the scheme "${scheme}" rather than \`Bearer\``,
      hint: 'The scheme is case-sensitive: it must be exactly `Bearer`, capitalised, followed by a single space and the JWT.',
    }
  }

  if (rest.length > 0) {
    return {
      kind: 'unreadable',
      reason: `the Authorization header used the "${scheme}" scheme, not \`Bearer\``,
      hint: 'Only `Authorization: Bearer <jwt>` is read as a user credential.',
    }
  }

  return {
    kind: 'unreadable',
    reason: 'the Authorization header carried a bare value with no scheme',
    hint: 'It must be `Authorization: Bearer <jwt>` — the scheme is not optional.',
  }
}

/**
 * Diagnosis for an `sb_*` API key found in the `Authorization` header. Shared so
 * `verifyCredentials` and the claims gate word it the same way.
 *
 * @internal
 */
export const ApiKeyInAuthorizationHeader = {
  reason: 'the Authorization header carried an sb_* API key, not a user JWT',
  hint:
    'API keys belong in the `apikey` header. The Supabase SDK sends the key in both the `apikey` ' +
    'and `Authorization` headers, which is why this is easy to miss.',
} as const

/**
 * Diagnosis for Supabase API keys arriving at an endpoint that reads none — a
 * `user`-only gate. supabase-js sends the publishable key in both the `apikey`
 * and `Authorization` headers, so an unauthenticated client lands here with a
 * key in each slot; reporting "your key matched nothing" would send the caller
 * hunting for a key mismatch that does not exist. Shared so `verifyCredentials`
 * and the claims gate word an identical request identically.
 *
 * @internal
 */
export function apiKeyOnUserOnlyEndpoint(slots: {
  /** An `sb_*` value rode the `Authorization` header. */
  inAuthorization: boolean
  /** An `apikey` header was present, whatever its format. */
  inApiKeyHeader: boolean
}): { reason: string; hint: string } {
  return {
    reason: slots.inApiKeyHeader
      ? 'an apikey header, which no accepted auth mode reads'
      : 'an sb_* API key in the Authorization header, which no accepted auth mode reads',
    hint:
      'This endpoint authenticates a user, not a project — an API key can never satisfy it, ' +
      'whichever header it arrives in.' +
      (slots.inAuthorization
        ? ' supabase-js sends the publishable key in both the `apikey` and `Authorization` ' +
          'headers, so an unauthenticated client lands here even though a bearer token appears ' +
          "to have been sent; a signed-in session's access token replaces it."
        : ''),
  }
}
