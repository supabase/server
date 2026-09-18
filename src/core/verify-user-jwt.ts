import {
  createLocalJWKSet,
  createRemoteJWKSet,
  decodeProtectedHeader,
  importJWK,
  JSONWebKeySet,
  jwtVerify,
  type JWTPayload,
  type JWTVerifyGetKey,
  type JWTVerifyOptions,
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
  /** The key set as currently cached; `undefined` before the first fetch. */
  jwks: () => JSONWebKeySet | undefined
  /** Fetches the key set into the cache. Present on remote resolvers only. */
  reload?: () => Promise<void>
  /** `true` while a fetch happened within the cooldown window. Remote resolvers only. */
  coolingDown?: boolean
  /** `true` while the cached key set is within its max age. Remote resolvers only. */
  fresh?: boolean
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
 * endpoint outage is not a bad request. An `aud` / `iss` mismatch is a
 * `token` failure: the same `jose` error covers a mistyped option and a token
 * from another project, so the hint names both and the status is `401`.
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
      return describeClaimFailure(error)
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

/**
 * The verify option that drives each claim check, and the value Supabase Auth
 * puts in that claim on a user access token.
 *
 * @internal
 */
const ConfiguredClaims = {
  aud: {
    option: 'audience',
    issued: 'Supabase Auth sets "aud" to "authenticated" on user access tokens',
  },
  iss: {
    option: 'issuer',
    issued:
      'Supabase Auth sets "iss" to the project\'s Auth URL, ' +
      'https://<project-ref>.supabase.co/auth/v1, with no trailing slash',
  },
} as const

/**
 * Translates a `jose` claim-validation failure into a reason that names the
 * claim and a hint aimed at whoever can fix it.
 *
 * `aud` and `iss` are the only checks driven by server configuration, so their
 * hint points at the option first: the same `jose` error covers a mistyped
 * option (every request fails) and a token from another project (some do).
 * A future `nbf` is a clock question. A claim with the wrong type (`jose`
 * reason `invalid`) is malformed, whatever the claim. Anything else keeps the
 * claim name and a generic hint.
 *
 * @internal
 */
function describeClaimFailure(error: unknown): {
  reason: string
  hint: string
} {
  const { claim, reason } = (error ?? {}) as {
    claim?: unknown
    reason?: unknown
  }
  const name = typeof claim === 'string' ? claim : 'unspecified'

  if (name === 'aud' || name === 'iss') {
    const { option, issued } = ConfiguredClaims[name]
    return {
      reason:
        reason === 'missing'
          ? `it has no "${name}" claim, but an ${option} is configured`
          : `its "${name}" claim does not match the configured ${option}`,
      hint:
        `Compare the "${option}" option with what the token carries: ${issued}. ` +
        'If every request fails, the option is wrong; if only some do, those tokens were issued by ' +
        `a different project. Omit the option to skip ${option} validation.`,
    }
  }

  if (name === 'nbf' && reason === 'check_failed') {
    return {
      reason: 'its "nbf" claim is in the future',
      hint:
        'The token is not valid yet. Check the server clock for skew against Supabase Auth, ' +
        'then retry once "nbf" has passed.',
    }
  }

  if (reason === 'invalid') {
    return {
      reason: `its "${name}" claim is malformed`,
      hint:
        'The claim is present but has the wrong type. Supabase Auth issues numeric "iat", "nbf", ' +
        'and "exp" claims, so check which service minted the token.',
    }
  }

  return {
    reason:
      name === 'unspecified'
        ? 'a registered claim failed validation'
        : `its "${name}" claim failed validation`,
    hint: 'Check the server clock for skew and that the token came from the expected Supabase project.',
  }
}

/** @internal */
const MalformedTokenHint =
  'The Authorization header must carry a compact JWS — three base64url segments separated by dots. ' +
  'Check the token was not truncated, URL-encoded, or wrapped in quotes.'

/** @internal */
export interface VerifyUserJwtOptions {
  audience?: string | string[]
  issuer?: string | string[]
}

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
 * (expired, bad signature, unknown `kid`, malformed, no `sub`, mismatched
 * `aud` / `iss`) rather than a blanket "invalid credentials".
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
  options?: VerifyUserJwtOptions,
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

  if (
    options?.audience === '' ||
    (options?.audience as unknown) === null ||
    (Array.isArray(options?.audience) && options.audience.some((a) => !a))
  ) {
    return {
      ok: false,
      failure: {
        kind: 'token',
        reason: 'the configured "audience" option is empty',
        hint: 'Pass a non-empty string or array, or omit the option to skip audience validation.',
        jwt,
      },
    }
  }
  if (
    options?.issuer === '' ||
    (options?.issuer as unknown) === null ||
    (Array.isArray(options?.issuer) && options.issuer.some((i) => !i))
  ) {
    return {
      ok: false,
      failure: {
        kind: 'token',
        reason: 'the configured "issuer" option is empty',
        hint: 'Pass a non-empty string or array, or omit the option to skip issuer validation.',
        jwt,
      },
    }
  }

  try {
    const jwkResolver = getJwksResolver(jwks)
    let payload: JWTPayload | null = null

    const verifyOptions: JWTVerifyOptions = {
      audience: options?.audience,
      issuer: options?.issuer,
    }

    // Symmetric algorithm requires importing the shared secret
    if (alg === 'HS256') {
      // A remote resolver refreshes its key set only from inside `jwtVerify`,
      // which the symmetric lookup never calls. This branch applies jose's own
      // policy by hand: load the key set when it is absent or past its max
      // age, and on an unknown `kid` reload once unless a fetch happened within
      // the cooldown window. "No matching key" is reported only after that, so
      // a rotated key is picked up without a restart and a hostile `kid`
      // cannot force a fetch per request.
      const findKey = () =>
        jwkResolver
          .jwks()
          ?.keys.find((key) => key.alg === alg && key.kid === kid)

      if (jwkResolver.jwks() === undefined || jwkResolver.fresh === false) {
        await jwkResolver.reload?.()
      }
      let jwk = findKey()
      if (!jwk && jwkResolver.reload && jwkResolver.coolingDown === false) {
        await jwkResolver.reload()
        jwk = findKey()
      }
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

      const verify = await jwtVerify(token, sharedSecret, verifyOptions)
      payload = verify.payload
    } else {
      const verify = await jwtVerify(token, jwkResolver, verifyOptions)
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
