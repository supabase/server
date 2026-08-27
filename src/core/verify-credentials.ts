import {
  AuthError,
  EnvGenericError,
  Errors,
  InvalidCredentialsError,
} from '../errors.js'
import type {
  AuthMode,
  AuthModeWithKey,
  AuthResult,
  Credentials,
  SupabaseEnv,
} from '../types.js'
import { resolveEnv } from './resolve-env.js'
import { resolveAuthOption } from './utils/deprecation.js'
import { timingSafeEqual } from './utils/timing-safe-equal.js'
import { verifyUserJwt } from './verify-user-jwt.js'

export type { JwksResolver } from './verify-user-jwt.js'

/**
 * Options for {@link verifyCredentials}.
 * @category Primitives
 */
export interface VerifyCredentialsOptions {
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

const INVALID = Symbol('invalid')

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
      const verified = await verifyUserJwt(credentials.token, env.jwks)
      if (!verified) {
        return INVALID
      }
      return {
        authMode: 'user',
        token: credentials.token,
        userClaims: verified.userClaims,
        jwtClaims: verified.jwtClaims,
        keyName: null,
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
 * When `user` is among the allowed modes, a request carries a user token, and
 * no JWKS source is configured, the failure is a 500 `ENV_ERROR` rather than
 * a 401: the token cannot be verified, and that is a server misconfiguration,
 * not a caller error. Another allowed mode matching the request's credentials
 * still wins — the 500 is reported only when nothing matched.
 *
 * @param credentials - The credentials to verify (from {@link extractCredentials}).
 * @param options - Allowed auth modes and optional env overrides.
 * @returns `{ data: AuthResult, error: null }` on success, `{ data: null, error: AuthError }` on failure.
 *
 * @example Multiple auth modes
 * ```ts
 * const credentials = extractCredentials(request)
 * const { data: auth, error } = await verifyCredentials(credentials, {
 *   auth: ['user', 'publishable'],
 * })
 * if (error) {
 *   return Response.json({ message: error.message }, { status: error.status })
 * }
 * ```
 *
 * @category Primitives
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

  // A user token that cannot be verified because no JWKS source is
  // configured is a server misconfiguration, not a caller error — the same
  // 500 `ENV_ERROR` the standalone claims middleware reports. Checked only
  // after every mode has been tried, so key-based fallthrough (e.g.
  // `['user', 'secret']` with a valid apikey) is unaffected. `sb_*` values
  // in the Authorization slot are API keys, not user tokens, and stay a
  // caller error.
  const userTokenUnverifiable =
    !env.jwks &&
    credentials.token !== null &&
    !credentials.token.startsWith('sb_') &&
    modes.some((mode) => parseAuthMode(mode).base === 'user')
  if (userTokenUnverifiable) {
    return {
      data: null,
      error: new AuthError(
        'A JWKS source is required to verify user tokens. Set SUPABASE_JWKS or SUPABASE_JWKS_URL, or pass `jwks` in the env overrides.',
        EnvGenericError,
        500,
      ),
    }
  }

  return {
    data: null,
    error: Errors[InvalidCredentialsError](),
  }
}
