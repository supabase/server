import { createLocalJWKSet, jwtVerify } from 'jose'

import { AuthError } from '../errors.js'
import type {
  Allow,
  AllowWithKey,
  AuthResult,
  Credentials,
  JWTClaims,
  SupabaseEnv,
  UserIdentity,
} from '../types.js'
import { timingSafeEqual } from './utils/timing-safe-equal.js'
import { resolveEnv } from './resolve-env.js'

interface VerifyCredentialsOptions {
  allow: AllowWithKey | AllowWithKey[]
  env?: Partial<SupabaseEnv>
}

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
  return { base, keyName }
}

function claimsToUser(claims: JWTClaims): UserIdentity {
  return {
    id: claims.sub,
    role: claims.role,
    email: claims.email,
    appMetadata: claims.app_metadata,
    userMetadata: claims.user_metadata,
  }
}

async function tryMode(
  mode: AllowWithKey,
  credentials: Credentials,
  env: SupabaseEnv,
): Promise<AuthResult | null> {
  const { base, keyName } = parseAllowMode(mode)

  switch (base) {
    case 'always':
      return { authType: 'always', token: null, user: null, claims: null }

    case 'public': {
      if (!credentials.apikey) return null
      const keys = keyName
        ? env.publishableKeys.filter((k) => k.name === keyName)
        : env.publishableKeys
      for (const k of keys) {
        if (await timingSafeEqual(credentials.apikey, k.key)) {
          return {
            authType: 'public',
            token: null,
            user: null,
            claims: null,
          }
        }
      }
      return null
    }

    case 'secret': {
      if (!credentials.apikey) return null
      const keys = keyName
        ? env.secretKeys.filter((k) => k.name === keyName)
        : env.secretKeys
      for (const k of keys) {
        if (await timingSafeEqual(credentials.apikey, k.key)) {
          return {
            authType: 'secret',
            token: null,
            user: null,
            claims: null,
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
        const claims = payload as unknown as JWTClaims
        return {
          authType: 'user',
          token: credentials.token,
          user: claimsToUser(claims),
          claims,
        }
      } catch {
        return null
      }
    }

    default:
      return null
  }
}

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
