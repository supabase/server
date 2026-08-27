import {
  AuthError,
  Errors,
  InvalidApiKeyError,
  InvalidCredentialsError,
  InvalidJwtError,
  JwksFetchFailedError,
  JwksNotConfiguredError,
  MissingCredentialsError,
  NoKeysConfiguredError,
  type AuthFailureContext,
} from '../errors.js'
import type {
  AuthMode,
  AuthModeWithKey,
  AuthResult,
  Credentials,
  SupabaseEnv,
} from '../types.js'
import { resolveEnv } from './resolve-env.js'
import { classifyApiKey } from './utils/classify-credentials.js'
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

/**
 * Why a mode didn't apply to the request. Collected as the mode chain falls
 * through so the final error can name the actual cause instead of a generic
 * "invalid credentials".
 *
 * @internal
 */
type ModeSkip =
  /** Mode needs an `apikey` header; the request had none. */
  | { reason: 'no-apikey' }
  /** Mode needs a bearer token; the request had none. */
  | { reason: 'no-token' }
  /** `Authorization` carried an `sb_*` API key rather than a JWT. */
  | { reason: 'token-is-api-key' }
  /** Auth mode `"user"` with a JWT present, but no JWKS to verify it against. */
  | { reason: 'jwks-not-configured' }
  /** The mode's key set has no key it could ever match — a misconfiguration. */
  | {
      reason: 'no-keys-configured'
      mode: string
      keyKind: 'publishable' | 'secret'
    }
  /** A key was present and the mode had keys, but none matched. */
  | { reason: 'apikey-mismatch' }

/**
 * Result of attempting a single auth mode.
 *
 * `reject` short-circuits the whole chain (a credential was present and
 * definitively bad); `skip` falls through to the next mode. The error is
 * returned as a thunk because only {@link verifyCredentials} knows the full
 * {@link AuthFailureContext}.
 *
 * @internal
 */
type ModeOutcome =
  | { kind: 'match'; auth: AuthResult }
  | { kind: 'reject'; error: (context: AuthFailureContext) => AuthError }
  | { kind: 'skip'; skip: ModeSkip }

const NoToken: ModeOutcome = { kind: 'skip', skip: { reason: 'no-token' } }
const NoApiKey: ModeOutcome = { kind: 'skip', skip: { reason: 'no-apikey' } }
const ApiKeyMismatch: ModeOutcome = {
  kind: 'skip',
  skip: { reason: 'apikey-mismatch' },
}

/**
 * Matches an `apikey` against a mode's key set, honouring the `:*` wildcard and
 * named-key syntax. Returns the matched key name, or `null` when nothing matched.
 *
 * @internal
 */
async function matchApiKey(
  apikey: string,
  keys: Record<string, string>,
  keyName: string | null,
): Promise<string | null> {
  if (keyName === '*') {
    for (const [name, value] of Object.entries(keys)) {
      if (await timingSafeEqual(apikey, value)) return name
    }
    return null
  }

  const name = keyName ?? 'default'
  const value = keys[name]
  if (value && (await timingSafeEqual(apikey, value))) return name
  return null
}

/**
 * Attempts to authenticate credentials against a single auth mode.
 *
 * Returns a `match` on success, a `reject` when a credential was present but
 * definitively bad (the chain must stop), or a `skip` carrying the reason the
 * mode didn't apply (the chain continues, and the reason feeds the final error).
 *
 * @internal
 */
async function tryMode(
  mode: AuthModeWithKey,
  credentials: Credentials,
  env: SupabaseEnv,
): Promise<ModeOutcome> {
  const { base, keyName } = parseAuthMode(mode)

  switch (base) {
    case 'none':
      return {
        kind: 'match',
        auth: {
          authMode: 'none',
          token: null,
          userClaims: null,
          jwtClaims: null,
          keyName: null,
        },
      }

    case 'publishable':
    case 'secret': {
      if (!credentials.apikey) return NoApiKey

      const keys = base === 'publishable' ? env.publishableKeys : env.secretKeys

      // A mode whose key set can never yield a match is a server
      // misconfiguration, not a bad request. Record it so the final error can
      // say so — but keep falling through, since a later mode may still match.
      const reachable =
        keyName === '*' || keyName === null
          ? Object.keys(keys).length > 0
          : keys[keyName] !== undefined
      if (!reachable) {
        return {
          kind: 'skip',
          skip: { reason: 'no-keys-configured', mode, keyKind: base },
        }
      }

      const matched = await matchApiKey(credentials.apikey, keys, keyName)
      if (matched === null) return ApiKeyMismatch

      return {
        kind: 'match',
        auth: {
          authMode: base,
          token: null,
          userClaims: null,
          jwtClaims: null,
          keyName: matched,
        },
      }
    }

    case 'user': {
      if (!credentials.token) return NoToken
      // The Supabase SDK forwards `sb_*` secrets in the Authorization header
      // alongside the apikey header. Treat them as not-applicable here so the
      // chain falls through to `secret` / `publishable` instead of failing
      // JWT verification.
      if (credentials.token.startsWith('sb_')) {
        return { kind: 'skip', skip: { reason: 'token-is-api-key' } }
      }
      if (!env.jwks) {
        return { kind: 'skip', skip: { reason: 'jwks-not-configured' } }
      }

      const verified = await verifyUserJwt(credentials.token, env.jwks)
      if (!verified.ok) {
        const { failure } = verified
        return {
          kind: 'reject',
          error: (context) =>
            failure.kind === 'jwks-source'
              ? Errors[JwksFetchFailedError]({
                  ...context,
                  reason: failure.reason,
                  cause: failure.cause,
                })
              : Errors[InvalidJwtError]({
                  ...context,
                  reason: failure.reason,
                  hint: failure.hint,
                  jwt: failure.jwt,
                  cause: failure.cause,
                }),
        }
      }

      return {
        kind: 'match',
        auth: {
          authMode: 'user',
          token: credentials.token,
          userClaims: verified.userClaims,
          jwtClaims: verified.jwtClaims,
          keyName: null,
        },
      }
    }

    default:
      return NoApiKey
  }
}

/**
 * Builds the non-sensitive diagnostics shared by every failure path: which
 * modes were attempted, what the request carried, and the *names* of the keys
 * configured for the attempted modes. Never includes key values or token
 * payloads.
 *
 * @internal
 */
function buildFailureContext(
  modes: readonly AuthModeWithKey[],
  credentials: Credentials,
  env: SupabaseEnv,
): AuthFailureContext {
  const usesKeyKind = (kind: 'publishable' | 'secret') =>
    modes.some((mode) => mode === kind || mode.startsWith(`${kind}:`))

  const configuredKeyNames: Record<string, readonly string[]> = {}
  if (usesKeyKind('publishable')) {
    configuredKeyNames.publishable = Object.keys(env.publishableKeys)
  }
  if (usesKeyKind('secret')) {
    configuredKeyNames.secret = Object.keys(env.secretKeys)
  }

  return {
    authModes: modes,
    received: {
      authorization: !credentials.token
        ? 'absent'
        : // The Supabase SDK forwards `sb_*` secrets in this header too; saying
          // "bearer" would imply a JWT arrived when it did not.
          credentials.token.startsWith('sb_')
          ? 'api-key'
          : 'bearer',
      apikey: classifyApiKey(credentials.apikey),
    },
    ...(Object.keys(configuredKeyNames).length > 0
      ? { configuredKeyNames }
      : {}),
  }
}

/**
 * Picks the most useful error once every mode has fallen through.
 *
 * Server misconfiguration wins over credential problems: if a mode could never
 * have matched — no JWKS to verify a JWT against, or no keys for a key mode —
 * that's a `500` the operator needs to see, not a `401` blamed on the caller.
 *
 * @internal
 */
function explainFallthrough(
  skips: readonly ModeSkip[],
  context: AuthFailureContext,
): AuthError {
  if (skips.some((skip) => skip.reason === 'jwks-not-configured')) {
    return Errors[JwksNotConfiguredError](context)
  }

  const unreachableMode = skips.find(
    (skip): skip is Extract<ModeSkip, { reason: 'no-keys-configured' }> =>
      skip.reason === 'no-keys-configured',
  )
  if (unreachableMode) {
    return Errors[NoKeysConfiguredError]({
      ...context,
      mode: unreachableMode.mode,
      keyKind: unreachableMode.keyKind,
    })
  }

  // `api-key` and `non-bearer-scheme` mean the header arrived but carried
  // nothing usable — the same situation as absent, and reported the same way so
  // this matches what `withRequiredClaims` says for an identical request.
  const { authorization, apikey } = context.received
  if (authorization !== 'bearer' && apikey === 'absent') {
    return Errors[MissingCredentialsError](context)
  }
  if (apikey !== 'absent') {
    return Errors[InvalidApiKeyError](context)
  }
  return Errors[InvalidCredentialsError](context)
}

/**
 * Verifies pre-extracted credentials against one or more allowed auth modes.
 *
 * Tries each mode in order — first match wins. A mode is only tried when its
 * credential is present; a JWT that is present but fails verification
 * short-circuits the chain with {@link InvalidJwtError} instead of falling
 * through to the next mode. Use {@link verifyAuth} to extract and verify in a
 * single call.
 *
 * When every mode falls through, the returned error names the actual cause
 * rather than a generic failure — {@link MissingCredentialsError} when the
 * request carried nothing, {@link InvalidApiKeyError} when an `apikey` matched
 * no configured key, or a `500` ({@link JwksNotConfiguredError},
 * {@link NoKeysConfiguredError}) when the server is configured such that no
 * request could ever have succeeded. Every error carries `hint`, `docs`, and
 * non-sensitive `details`.
 *
 * A misconfiguration `500` is only reported once nothing has matched, so an
 * allowed mode that does match the request's credentials still wins — e.g.
 * `['user', 'secret']` with no JWKS but a valid apikey authenticates as
 * `secret`. `sb_*` values in the Authorization slot are API keys, not user
 * tokens, and stay a caller error.
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
 *   console.error(error.code, error.message, error.hint)
 *   return Response.json(error.toJSON(), { status: error.status })
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
    // The EnvError already names the exact missing variable — keep its code,
    // hint, and details rather than flattening to a generic auth failure.
    return {
      data: null,
      error: new AuthError(envError.message, envError.code, 500, {
        hint: envError.hint,
        details: envError.details,
        docs: envError.docs,
        cause: envError,
      }),
    }
  }

  const resolved = resolveAuthOption(options)
  const modes = Array.isArray(resolved) ? resolved : [resolved]

  const skips: ModeSkip[] = []
  for (const mode of modes) {
    const outcome = await tryMode(mode, credentials, env)
    if (outcome.kind === 'match') {
      return { data: outcome.auth, error: null }
    }
    if (outcome.kind === 'reject') {
      return {
        data: null,
        error: outcome.error(buildFailureContext(modes, credentials, env)),
      }
    }
    skips.push(outcome.skip)
  }

  // An unverifiable user token (#128) is reported by `explainFallthrough` from
  // the `jwks-not-configured` skip the `user` mode records — same guards, same
  // after-every-mode timing, but as JWKS_NOT_CONFIGURED rather than a generic
  // ENV_ERROR.
  return {
    data: null,
    error: explainFallthrough(
      skips,
      buildFailureContext(modes, credentials, env),
    ),
  }
}
