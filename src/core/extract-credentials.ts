import type { Credentials } from '../types.js'

/**
 * Extracts authentication credentials from an incoming HTTP request.
 *
 * Reads two headers:
 * - `Authorization: Bearer <token>` → extracted as `token`
 * - `apikey: <key>` → extracted as `apikey`
 *
 * This is a pure extraction step — no validation or verification is performed.
 * Pass the result to {@link verifyCredentials} to validate against allowed auth modes.
 *
 * @param request - The incoming HTTP request.
 * @returns The extracted {@link Credentials}. Fields are `null` when the corresponding header is absent.
 *
 * @example
 * ```ts
 * import { extractCredentials } from '@supabase/edge-functions/core'
 *
 * const creds = extractCredentials(request)
 * console.log(creds.token)  // "eyJhbGci..." or null
 * console.log(creds.apikey) // "sb-abc123-publishable-..." or null
 * ```
 */
export function extractCredentials(request: Request): Credentials {
  const authHeader = request.headers.get('authorization')
  const token = authHeader?.startsWith('Bearer ')
    ? authHeader.slice(7) || null
    : null

  const apikey = request.headers.get('apikey')

  return { token, apikey }
}
