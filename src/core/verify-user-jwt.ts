import {
  createLocalJWKSet,
  createRemoteJWKSet,
  decodeProtectedHeader,
  importJWK,
  JSONWebKeySet,
  jwtVerify,
  type JWTPayload,
  type JWTVerifyGetKey,
} from 'jose'

import type { JWTClaims, UserClaims } from '../types.js'

/**
 * Converts raw {@link JWTClaims} (snake_case) to a normalized {@link UserClaims} (camelCase).
 * @internal
 */
export function jwtClaimsToUserClaims(jwtClaims: JWTClaims): UserClaims {
  return {
    id: jwtClaims.sub,
    role: jwtClaims.role,
    email: jwtClaims.email,
    appMetadata: jwtClaims.app_metadata,
    userMetadata: jwtClaims.user_metadata,
  }
}

/**
 * A JWKS key resolver with an accessor for the cached key set.
 * @category Primitives
 */
export type JwksResolver = JWTVerifyGetKey & {
  jwks: () => JSONWebKeySet | undefined
}

let remoteJwksResolver: { url: string; resolver: JwksResolver } | undefined =
  undefined

/**
 * Returns a key resolver for the given JWKS source.
 *
 * For a {@link URL}, the underlying `createRemoteJWKSet` resolver is cached
 * across requests so `jose`'s built-in cooldown / max-age caching is
 * preserved. Local JWKS objects are wrapped on every call — they're trivially
 * cheap and the object identity may change across requests.
 *
 * @internal
 */
function getJwksResolver(jwks: JSONWebKeySet | URL): JwksResolver {
  if (jwks instanceof URL) {
    const url = jwks.toString()
    if (remoteJwksResolver?.url !== url) {
      remoteJwksResolver = { url, resolver: createRemoteJWKSet(jwks) }
    }
    return remoteJwksResolver.resolver
  }

  const localJwkSet = createLocalJWKSet(jwks)
  function localJwtVerifyGetKey(...args: Parameters<typeof localJwkSet>) {
    return localJwkSet(...args)
  }

  const localJwksResolver: JwksResolver = Object.assign(localJwtVerifyGetKey, {
    jwks: () => jwks,
  })

  return localJwksResolver
}

/**
 * Why a JWT failed verification, in terms a caller can act on.
 *
 * `kind` separates the two audiences: `token` failures are the caller's
 * problem (`401`), `jwks-source` failures are the operator's (`500`) — a JWKS
 * endpoint outage is not a bad request.
 *
 * @internal
 */
export interface JwtFailure {
  kind: 'token' | 'jwks-source'
  /** Plain-language reason, phrased to follow "failed verification: …". */
  reason: string
  /** Actionable next step. */
  hint: string
  /** Non-sensitive header fields (`alg`, `kid`). Never claim values. */
  jwt: Record<string, unknown>
  /** The underlying `jose` error, when there was one. */
  cause?: unknown
}

/**
 * Result of {@link verifyUserJwt}: the claims on success, or a described
 * failure. Discriminate on `ok`.
 *
 * @internal
 */
export type VerifyUserJwtResult =
  | { ok: true; jwtClaims: JWTClaims; userClaims: UserClaims }
  | { ok: false; failure: JwtFailure }

/**
 * `jose` error codes that mean the *JWKS* could not be obtained or parsed,
 * rather than that the token was bad.
 *
 * @internal
 */
const JwksSourceErrorCodes = new Set([
  'ERR_JWKS_TIMEOUT',
  'ERR_JWKS_INVALID',
  'ERR_JOSE_GENERIC',
])

/** Reads a `jose` error code (`ERR_*`) off a thrown value, if present. @internal */
function joseErrorCode(error: unknown): string | undefined {
  const code = (error as { code?: unknown } | null)?.code
  return typeof code === 'string' && code.startsWith('ERR_') ? code : undefined
}

/**
 * Translates a `jose` verification failure into a reason and a hint.
 *
 * @internal
 */
function describeJoseFailure(error: unknown): { reason: string; hint: string } {
  switch (joseErrorCode(error)) {
    case 'ERR_JWT_EXPIRED':
      return {
        reason: 'the token has expired',
        hint:
          'Refresh the session on the client (supabase.auth.refreshSession()) and retry with the new ' +
          'access token. If tokens appear to expire immediately, check the server clock for skew.',
      }
    case 'ERR_JWS_SIGNATURE_VERIFICATION_FAILED':
      return {
        reason: 'the signature did not verify against the configured JWKS',
        hint:
          'The token was signed by a different key than the JWKS provides. Check that ' +
          'SUPABASE_JWKS_URL / SUPABASE_JWKS belongs to the same Supabase project that issued the token.',
      }
    case 'ERR_JWKS_NO_MATCHING_KEY':
      return {
        reason: 'no key in the JWKS matches the token\'s "kid"',
        hint:
          'Either the JWKS belongs to a different Supabase project, or the signing key was rotated and ' +
          'the JWKS is stale. Prefer SUPABASE_JWKS_URL over inline SUPABASE_JWKS so rotations are picked ' +
          'up automatically.',
      }
    case 'ERR_JWKS_MULTIPLE_MATCHING_KEYS':
      return {
        reason: 'more than one key in the JWKS matches the token\'s "kid"',
        hint:
          'The JWKS contains duplicate "kid" values. Remove the duplicates, or point SUPABASE_JWKS_URL ' +
          "at the project's own /auth/v1/.well-known/jwks.json.",
      }
    case 'ERR_JWT_CLAIM_VALIDATION_FAILED':
      return {
        reason: 'a registered claim failed validation',
        hint:
          'Usually "nbf" (not-before) being in the future, or a mismatched "aud" / "iss". Check the ' +
          'server clock and that the token came from the expected Supabase project.',
      }
    case 'ERR_JOSE_ALG_NOT_ALLOWED':
    case 'ERR_JOSE_NOT_SUPPORTED':
      return {
        reason: "the token's signing algorithm is not supported",
        hint:
          'Supabase signs JWTs with ES256, RS256, or HS256. A token using anything else was not issued ' +
          'by Supabase Auth.',
      }
    default:
      return {
        reason: 'the token is malformed',
        hint: MalformedTokenHint,
      }
  }
}

/** @internal */
const MalformedTokenHint =
  'The Authorization header must carry a compact JWS — three base64url segments separated by dots. ' +
  'Check the token was not truncated, URL-encoded, or wrapped in quotes.'

/**
 * Verifies a user JWT against the project JWKS — the single verification core
 * shared by `verifyCredentials`'s `user` mode and the `withClaims` /
 * `withRequiredClaims` middleware.
 *
 * Handles both asymmetric keys (resolved through the JWKS) and the `HS256`
 * shared-secret case (imported from the matching JWK). A payload without a
 * string `sub` is rejected — a user token always identifies a subject.
 *
 * On failure it returns *why*, so callers can report the specific cause
 * (expired, bad signature, unknown `kid`, malformed, no `sub`) rather than a
 * blanket "invalid credentials".
 *
 * @param token - The bearer token to verify.
 * @param jwks - JWKS source: an inline key set or a remote JWKS URL.
 * @returns `{ ok: true, ...claims }` on success, `{ ok: false, failure }` otherwise.
 *
 * @internal
 */
export async function verifyUserJwt(
  token: string,
  jwks: JSONWebKeySet | URL,
): Promise<VerifyUserJwtResult> {
  let alg: string | undefined
  let kid: string | undefined
  try {
    ;({ alg, kid } = decodeProtectedHeader(token))
  } catch (e) {
    return {
      ok: false,
      failure: {
        kind: 'token',
        reason: 'its header could not be decoded',
        hint: MalformedTokenHint,
        jwt: { decodable: false },
        cause: e,
      },
    }
  }

  const jwt = { alg: alg ?? null, kid: kid ?? null }

  if (!alg || !kid) {
    const missing = [!alg && '"alg"', !kid && '"kid"']
      .filter(Boolean)
      .join(' and ')
    return {
      ok: false,
      failure: {
        kind: 'token',
        reason: `its header is missing ${missing}`,
        hint:
          'A JWT issued by a project using JWT signing keys carries both "alg" and "kid". A token ' +
          'with no "kid" is usually a legacy JWT signed with the project\'s shared JWT secret — ' +
          'migrate the project to JWT signing keys. For API keys use auth mode "publishable" / ' +
          '"secret" rather than "user".',
        jwt,
      },
    }
  }

  try {
    const jwkResolver = getJwksResolver(jwks)
    let payload: JWTPayload | null = null

    // Symmetric algorithm requires importing the shared secret
    if (alg === 'HS256') {
      const jwk = jwkResolver
        .jwks()
        ?.keys.find((key) => key.alg === alg && key.kid === kid)
      if (!jwk) {
        return {
          ok: false,
          failure: {
            kind: 'token',
            reason: 'no HS256 key in the JWKS matches the token\'s "kid"',
            hint:
              'The JWKS must contain the symmetric signing key (alg "HS256") with a matching "kid". ' +
              'Check SUPABASE_JWKS / SUPABASE_JWKS_URL belongs to the project that issued the token, ' +
              'and that its signing key has not been rotated.',
            jwt,
          },
        }
      }
      const sharedSecret = await importJWK(jwk, 'HS256')

      const verify = await jwtVerify(token, sharedSecret)
      payload = verify.payload
    } else {
      const verify = await jwtVerify(token, jwkResolver)
      payload = verify.payload
    }

    if (typeof payload.sub !== 'string') {
      return {
        ok: false,
        failure: {
          kind: 'token',
          reason: 'it has no "sub" claim, so it identifies no user',
          hint:
            'Auth mode "user" expects an end-user access token from Supabase Auth. A token without ' +
            '"sub" is typically a legacy anon / service_role JWT — use auth mode "publishable" or ' +
            '"secret" for those.',
          jwt,
        },
      }
    }
    const jwtClaims = payload as unknown as JWTClaims
    return { ok: true, jwtClaims, userClaims: jwtClaimsToUserClaims(jwtClaims) }
  } catch (e) {
    const code = joseErrorCode(e)
    // A JWKS that could not be fetched or parsed is a server / upstream fault.
    // A non-`jose` throw here is almost always the fetch itself failing, since
    // the token header already decoded cleanly.
    const jwksSourceFailed =
      (code && JwksSourceErrorCodes.has(code)) ||
      (code === undefined && jwks instanceof URL)
    if (jwksSourceFailed) {
      return {
        ok: false,
        failure: {
          kind: 'jwks-source',
          reason: e instanceof Error ? e.message : String(e),
          hint:
            'Check that SUPABASE_JWKS_URL points at a reachable JWKS endpoint and that the server ' +
            'has outbound network access to it. The endpoint must return 200 with a JSON ' +
            '`{ "keys": [...] }` body.',
          jwt,
          cause: e,
        },
      }
    }

    return {
      ok: false,
      failure: { kind: 'token', ...describeJoseFailure(e), jwt, cause: e },
    }
  }
}
