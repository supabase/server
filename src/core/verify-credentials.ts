import {
  createLocalJWKSet,
  createRemoteJWKSet,
  decodeProtectedHeader,
  importJWK,
  JSONWebKeySet,
  JWTPayload,
  jwtVerify,
  type JWTVerifyGetKey,
} from 'jose'

import { AuthError, Errors, InvalidCredentialsError } from '../errors.js'
import type {
  AuthMode,
  AuthModeWithKey,
  AuthResult,
  Credentials,
  JWTClaims,
  SupabaseEnv,
  UserClaims,
} from '../types.js'
import { resolveAuthOption } from './utils/deprecation.js'
import { timingSafeEqual } from './utils/timing-safe-equal.js'
import { resolveEnv } from './resolve-env.js'

/**
 * Options for {@link verifyCredentials}.
 */
interface VerifyCredentialsOptions {
  /**
   * Auth mode(s) to try. Modes are attempted in order — the first match wins.
   *
   * @see {@link AuthModeWithKey} for the full syntax including named keys.
   *
   * @defaultValue `"user"`
   */
  auth?: AuthModeWithKey | AuthModeWithKey[]

  /**
   * @deprecated Use {@link VerifyCredentialsOptions.auth} instead. Kept for
   * backward compatibility; will be removed in a future major release. When
   * both are provided, `auth` wins.
   */
  allow?: AuthModeWithKey | AuthModeWithKey[]

  /** Optional environment overrides (passed through to {@link resolveEnv}). */
  env?: Partial<SupabaseEnv>
}

/**
 * Parses an {@link AuthModeWithKey} string into its base mode and optional key name.
 *
 * @example
 * ```
 * parseAuthMode('user')              → { base: 'user',        keyName: null }
 * parseAuthMode('publishable:web')   → { base: 'publishable', keyName: 'web' }
 * parseAuthMode('secret:*')          → { base: 'secret',      keyName: '*' }
 * ```
 *
 * @internal
 */
function parseAuthMode(mode: AuthModeWithKey): {
  base: AuthMode
  keyName: string | null
} {
  if (
    mode === 'none' ||
    mode === 'publishable' ||
    mode === 'secret' ||
    mode === 'user'
  ) {
    return { base: mode, keyName: null }
  }
  const colonIndex = mode.indexOf(':')
  const base = mode.slice(0, colonIndex) as AuthMode
  const keyName = mode.slice(colonIndex + 1)
  if (!keyName) return { base, keyName: null }
  return { base, keyName }
}

/**
 * Converts raw {@link JWTClaims} (snake_case) to a normalized {@link UserClaims} (camelCase).
 * @internal
 */
function jwtClaimsToUserClaims(jwtClaims: JWTClaims): UserClaims {
  return {
    id: jwtClaims.sub,
    role: jwtClaims.role,
    email: jwtClaims.email,
    appMetadata: jwtClaims.app_metadata,
    userMetadata: jwtClaims.user_metadata,
  }
}

const INVALID = Symbol('invalid')

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
 * Attempts to authenticate credentials against a single auth mode.
 *
 * Returns:
 * - `AuthResult` on success.
 * - `null` if the mode doesn't apply (no relevant credential present — safe to try the next mode).
 * - `INVALID` if a credential was present but failed verification (must reject immediately).
 *
 * @internal
 */
async function tryMode(
  mode: AuthModeWithKey,
  credentials: Credentials,
  env: SupabaseEnv,
): Promise<AuthResult | typeof INVALID | null> {
  const { base, keyName } = parseAuthMode(mode)

  switch (base) {
    case 'none':
      return {
        authMode: 'none',
        token: null,
        userClaims: null,
        jwtClaims: null,
        keyName: null,
      }

    case 'publishable': {
      if (!credentials.apikey) return null
      const keys = env.publishableKeys

      if (keyName === '*') {
        for (const [name, value] of Object.entries(keys)) {
          if (await timingSafeEqual(credentials.apikey, value)) {
            return {
              authMode: 'publishable',
              token: null,
              userClaims: null,
              jwtClaims: null,
              keyName: name,
            }
          }
        }
      } else {
        const name = keyName ?? 'default'
        const value = keys[name]
        if (value && (await timingSafeEqual(credentials.apikey, value))) {
          return {
            authMode: 'publishable',
            token: null,
            userClaims: null,
            jwtClaims: null,
            keyName: name,
          }
        }
      }
      return null
    }

    case 'secret': {
      if (!credentials.apikey) return null
      const keys = env.secretKeys

      if (keyName === '*') {
        for (const [name, value] of Object.entries(keys)) {
          if (await timingSafeEqual(credentials.apikey, value)) {
            return {
              authMode: 'secret',
              token: null,
              userClaims: null,
              jwtClaims: null,
              keyName: name,
            }
          }
        }
      } else {
        const name = keyName ?? 'default'
        const value = keys[name]
        if (value && (await timingSafeEqual(credentials.apikey, value))) {
          return {
            authMode: 'secret',
            token: null,
            userClaims: null,
            jwtClaims: null,
            keyName: name,
          }
        }
      }
      return null
    }

    case 'user': {
      if (!credentials.token) return null
      // The Supabase SDK forwards `sb_*` secrets in the Authorization header
      // alongside the apikey header. Treat them as not-applicable here so the
      // chain falls through to `secret` / `publishable` instead of failing
      // JWT verification.
      if (credentials.token.startsWith('sb_')) return null
      if (!env.jwks) return null
      try {
        const jwkResolver = getJwksResolver(env.jwks)
        const { alg, kid } = decodeProtectedHeader(credentials.token)
        if (!alg || !kid) {
          return INVALID
        }

        let payload: JWTPayload | null = null

        // Symmetric algorithm requires importing the shared secret
        if (alg === 'HS256') {
          const jwk = jwkResolver
            .jwks()
            ?.keys.find((key) => key.alg === alg && key.kid === kid)
          if (!jwk) {
            return INVALID
          }
          const sharedSecret = await importJWK(jwk, 'HS256')

          const verify = await jwtVerify(credentials.token, sharedSecret)
          payload = verify.payload
        } else {
          const verify = await jwtVerify(credentials.token, jwkResolver)
          payload = verify.payload
        }

        if (typeof payload.sub !== 'string') {
          return INVALID
        }
        const jwtClaims = payload as unknown as JWTClaims
        return {
          authMode: 'user',
          token: credentials.token,
          userClaims: jwtClaimsToUserClaims(jwtClaims),
          jwtClaims,
          keyName: null,
        }
      } catch {
        return INVALID
      }
    }

    default:
      return null
  }
}

/**
 * Verifies pre-extracted credentials against one or more allowed auth modes.
 *
 * Tries each mode in order — first match wins. A mode is only tried when its
 * credential is present; a JWT that is present but fails verification
 * short-circuits the chain with `InvalidCredentialsError` instead of falling
 * through to the next mode. Use {@link verifyAuth} to extract and verify in a
 * single call.
 *
 * @param credentials - The credentials to verify (from {@link extractCredentials}).
 * @param options - Allowed auth modes and optional env overrides.
 * @returns `{ data: AuthResult, error: null }` on success, `{ data: null, error: AuthError }` on failure.
 *
 * @example
 * ```ts
 * const credentials = extractCredentials(request)
 * const { data: auth, error } = await verifyCredentials(credentials, {
 *   auth: ['user', 'publishable'],
 * })
 * if (error) {
 *   return Response.json({ message: error.message }, { status: error.status })
 * }
 * ```
 */
export async function verifyCredentials(
  credentials: Credentials,
  options: VerifyCredentialsOptions,
): Promise<
  { data: AuthResult; error: null } | { data: null; error: AuthError }
> {
  const { data: env, error: envError } = resolveEnv(options.env)
  if (envError) {
    return {
      data: null,
      error: new AuthError(envError.message, envError.code, 500),
    }
  }

  const resolved = resolveAuthOption(options)
  const modes = Array.isArray(resolved) ? resolved : [resolved]

  for (const mode of modes) {
    const result = await tryMode(mode, credentials, env)
    if (result === INVALID) {
      return { data: null, error: Errors[InvalidCredentialsError]() }
    }
    if (result) {
      return { data: result, error: null }
    }
  }

  return {
    data: null,
    error: Errors[InvalidCredentialsError](),
  }
}
