import type { Credentials } from '../types.js'

export function extractCredentials(request: Request): Credentials {
  const authHeader = request.headers.get('authorization')
  const token = authHeader?.startsWith('Bearer ')
    ? authHeader.slice(7) || null
    : null

  const apikey = request.headers.get('apikey')

  return { token, apikey }
}
