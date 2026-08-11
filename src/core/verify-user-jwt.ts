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
 * Verifies a user JWT against the project JWKS — the single verification core
 * shared by `verifyCredentials`'s `user` mode and the `withClaims` middleware.
 *
 * Handles both asymmetric keys (resolved through the JWKS) and the `HS256`
 * shared-secret case (imported from the matching JWK). A payload without a
 * string `sub` is rejected — a user token always identifies a subject.
 *
 * @param token - The bearer token to verify.
 * @param jwks - JWKS source: an inline key set or a remote JWKS URL.
 * @returns The decoded claims on success, `null` when verification fails.
 *
 * @internal
 */
export async function verifyUserJwt(
  token: string,
  jwks: JSONWebKeySet | URL,
): Promise<{ jwtClaims: JWTClaims; userClaims: UserClaims } | null> {
  try {
    const jwkResolver = getJwksResolver(jwks)
    const { alg, kid } = decodeProtectedHeader(token)
    if (!alg || !kid) {
      return null
    }

    let payload: JWTPayload | null = null

    // Symmetric algorithm requires importing the shared secret
    if (alg === 'HS256') {
      const jwk = jwkResolver
        .jwks()
        ?.keys.find((key) => key.alg === alg && key.kid === kid)
      if (!jwk) {
        return null
      }
      const sharedSecret = await importJWK(jwk, 'HS256')

      const verify = await jwtVerify(token, sharedSecret)
      payload = verify.payload
    } else {
      const verify = await jwtVerify(token, jwkResolver)
      payload = verify.payload
    }

    if (typeof payload.sub !== 'string') {
      return null
    }
    const jwtClaims = payload as unknown as JWTClaims
    return { jwtClaims, userClaims: jwtClaimsToUserClaims(jwtClaims) }
  } catch {
    return null
  }
}
