import { version } from '../version.js'
import type { CreateContextClientOptions } from '../types.js'

type SupabaseOptions = CreateContextClientOptions['supabaseOptions']
type ClientInfo = Record<string, string>

export const VIA = `supabase-server/${version}`

const MIDDLEWARE_KEY = 'middleware'

// Exclude jwtClaims: withSupabase sets it even without OAuth middleware.
const MIDDLEWARE_TAGS: Readonly<Record<string, string>> = {
  oauthProtectedResource: 'oauth-protected-resource',
}

function callerHeader(supabaseOptions: SupabaseOptions) {
  const header = Object.entries(supabaseOptions?.global?.headers ?? {})
    .reverse()
    .find(([name]) => name.toLowerCase() === 'x-client-info')
  return header
    ? { name: header[0], segments: header[1].split(';') }
    : undefined
}

function parameterKey(segment: string): string {
  return segment.split('=')[0].trim().toLowerCase()
}

export function buildClientInfo(supabaseOptions?: SupabaseOptions): ClientInfo {
  const clientInfo = supabaseOptions?.global?.clientInfo
  const hasVia =
    Object.keys(clientInfo ?? {}).some((key) => key.toLowerCase() === 'via') ||
    callerHeader(supabaseOptions)
      ?.segments.slice(1)
      .some((segment) => parameterKey(segment) === 'via')
  return { ...(hasVia ? {} : { via: VIA }), ...clientInfo }
}

export function detectMiddlewareTags(ctx: unknown): string[] {
  if (typeof ctx !== 'object' || ctx === null) return []
  return Object.entries(MIDDLEWARE_TAGS)
    .filter(([key]) => (ctx as Record<string, unknown>)[key] !== undefined)
    .map(([, tag]) => tag)
}

export function withMiddlewareTags(
  supabaseOptions: SupabaseOptions,
  detected: readonly string[],
): SupabaseOptions {
  if (detected.length === 0) return supabaseOptions
  const clientInfo = { ...supabaseOptions?.global?.clientInfo }
  const middlewareKey = Object.keys(clientInfo).find(
    (key) => key.toLowerCase() === MIDDLEWARE_KEY,
  )
  const header = callerHeader(supabaseOptions)
  // Avoid encoding existing header values again.
  if (
    middlewareKey === undefined &&
    header?.segments
      .slice(1)
      .some((segment) => parameterKey(segment) === MIDDLEWARE_KEY)
  ) {
    const supplied: string[] = []
    const kept = header.segments.filter((segment, index) => {
      if (index === 0) return true
      const separator = segment.indexOf('=')
      if (separator < 0 || parameterKey(segment) !== MIDDLEWARE_KEY) {
        return true
      }
      supplied.push(...segment.slice(separator + 1).split(','))
      return false
    })
    const headers = {
      ...supabaseOptions?.global?.headers,
      [header.name]: `${kept.join(';')}; middleware=${mergeTags(supplied, detected)}`,
    }
    return {
      ...supabaseOptions,
      global: { ...supabaseOptions?.global, headers },
    }
  }

  const key = middlewareKey ?? MIDDLEWARE_KEY
  clientInfo[key] = mergeTags((clientInfo[key] ?? '').split(','), detected)

  return {
    ...supabaseOptions,
    global: { ...supabaseOptions?.global, clientInfo },
  }
}

function mergeTags(supplied: string[], detected: readonly string[]): string {
  return [
    ...new Set([
      ...supplied.map((token) => token.trim()).filter(Boolean),
      ...detected,
    ]),
  ]
    .sort()
    .join(',')
}
