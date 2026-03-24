import { createLocalJWKSet, jwtVerify } from 'jose'

import { AuthError } from '../errors.js'
import type {
  Allow,
  AllowWithKey,
  AuthResult,
  Credentials,
  JWTClaims,
  SupabaseEnv,
  UserClaims,
} from '../types.js'
import { timingSafeEqual } from './utils/timing-safe-equal.js'
import { resolveEnv } from './resolve-env.js'

/**
 * Options for {@link verifyCredentials}.
 */
interface VerifyCredentialsOptions {
  /**
   * Auth mode(s) to try. Modes are attempted in order — the first match wins.
   *
   * @see {@link AllowWithKey} for the full syntax including named keys.
   */
  allow: AllowWithKey | AllowWithKey[]

  /** Optional environment overrides (passed through to {@link resolveEnv}). */
  env?: Partial<SupabaseEnv>
}

/**
 * Parses an {@link AllowWithKey} string into its base mode and optional key name.
 *
 * @example
 * ```
 * parseAllowMode('user')         → { base: 'user',   keyName: null }
 * parseAllowMode('public:web')   → { base: 'public', keyName: 'web' }
 * parseAllowMode('secret:*')     → { base: 'secret', keyName: '*' }
 * ```
 *
 * @internal
 */
function parseAllowMode(mode: AllowWithKey): {
  base: Allow
  keyName: string | null
} {
  if (
    mode === 'always' ||
    mode === 'public' ||
    mode === 'secret' ||
    mode === 'user'
  ) {
    return { base: mode, keyName: null }
  }
  const colonIndex = mode.indexOf(':')
  const base = mode.slice(0, colonIndex) as Allow
  const keyName = mode.slice(colonIndex + 1)
  if (!keyName) return { base, keyName: null }
  return { base, keyName }
}

/**
 * Converts raw {@link JWTClaims} (snake_case) to a normalized {@link UserClaims} (camelCase).
 * @internal
 */
function claimsToUserClaims(claims: JWTClaims): UserClaims {
  return {
    id: claims.sub,
    role: claims.role,
    email: claims.email,
    appMetadata: claims.app_metadata,
    userMetadata: claims.user_metadata,
  }
}

/**
 * Attempts to authenticate credentials against a single auth mode.
 * Returns the {@link AuthResult} on success, or `null` if the mode doesn't match.
 * @internal
 */
async function tryMode(
  mode: AllowWithKey,
  credentials: Credentials,
  env: SupabaseEnv,
): Promise<AuthResult | null> {
  const { base, keyName } = parseAllowMode(mode)

  switch (base) {
    case 'always':
      return {
        authType: 'always',
        token: null,
        userClaims: null,
        claims: null,
        keyName: null,
      }

    case 'public': {
      if (!credentials.apikey) return null
      const keys = env.publishableKeys

      if (keyName === '*') {
        for (const [name, value] of Object.entries(keys)) {
          if (await timingSafeEqual(credentials.apikey, value)) {
            return {
              authType: 'public',
              token: null,
              userClaims: null,
              claims: null,
              keyName: name,
            }
          }
        }
      } else {
        const name = keyName ?? 'default'
        const value = keys[name]
        if (value && (await timingSafeEqual(credentials.apikey, value))) {
          return {
            authType: 'public',
            token: null,
            userClaims: null,
            claims: null,
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
              authType: 'secret',
              token: null,
              userClaims: null,
              claims: null,
              keyName: name,
            }
          }
        }
      } else {
        const name = keyName ?? 'default'
        const value = keys[name]
        if (value && (await timingSafeEqual(credentials.apikey, value))) {
          return {
            authType: 'secret',
            token: null,
            userClaims: null,
            claims: null,
            keyName: name,
          }
        }
      }
      return null
    }

    case 'user': {
      if (!credentials.token) return null
      if (!env.jwks) return null
      try {
        const jwkSet = createLocalJWKSet(env.jwks)
        const { payload } = await jwtVerify(credentials.token, jwkSet)
        if (typeof payload.sub !== 'string') {
          return null
        }
        const claims = payload as unknown as JWTClaims
        return {
          authType: 'user',
          token: credentials.token,
          userClaims: claimsToUserClaims(claims),
          claims,
          keyName: null,
        }
      } catch {
        return null
      }
    }

    default:
      return null
  }
}

/**
 * Verifies pre-extracted credentials against one or more allowed auth modes.
 *
 * This is the core verification primitive. It resolves the environment, then tries
 * each allowed mode in order until one matches. Use {@link verifyAuth} if you want
 * to extract and verify in a single call.
 *
 * **Auth mode behavior:**
 *
 * | Mode       | Checks                                  | Result fields populated                |
 * | ---------- | --------------------------------------- | -------------------------------------- |
 * | `"always"` | Nothing — always succeeds               | `authType` only                        |
 * | `"public"` | `apikey` against publishable keys       | `authType`, `keyName`                  |
 * | `"secret"` | `apikey` against secret keys            | `authType`, `keyName`                  |
 * | `"user"`   | Bearer token as JWT (JWKS verification) | `authType`, `token`, `userClaims`, `claims` |
 *
 * @param credentials - The credentials to verify (from {@link extractCredentials}).
 * @param options - Verification options including allowed auth modes and optional env overrides.
 *
 * @returns A result tuple: `{ data, error }`.
 *   - On success: `{ data: AuthResult, error: null }`
 *   - On failure: `{ data: null, error: AuthError }` with status `401` (invalid credentials)
 *     or `500` (env misconfiguration)
 *
 * @example
 * ```ts
 * import { extractCredentials, verifyCredentials } from '@supabase/edge-functions/core'
 *
 * const credentials = extractCredentials(request)
 * const { data: auth, error } = await verifyCredentials(credentials, {
 *   allow: ['user', 'public'],
 * })
 *
 * if (error) {
 *   return Response.json({ error: error.message }, { status: error.status })
 * }
 *
 * console.log(auth.authType) // "user" or "public"
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

  const modes = Array.isArray(options.allow) ? options.allow : [options.allow]

  for (const mode of modes) {
    const result = await tryMode(mode, credentials, env)
    if (result) {
      return { data: result, error: null }
    }
  }

  return {
    data: null,
    error: new AuthError('Invalid credentials', 'INVALID_CREDENTIALS', 401),
  }
}
