import type { AuthError } from '../errors.js'
import type { AllowWithKey, AuthResult, SupabaseEnv } from '../types.js'
import { extractCredentials } from './extract-credentials.js'
import { verifyCredentials } from './verify-credentials.js'

interface VerifyAuthOptions {
  allow: AllowWithKey | AllowWithKey[]
  env?: Partial<SupabaseEnv>
}

export async function verifyAuth(
  request: Request,
  options: VerifyAuthOptions,
): Promise<
  { data: AuthResult; error: null } | { data: null; error: AuthError }
> {
  const credentials = extractCredentials(request)
  return verifyCredentials(credentials, options)
}
