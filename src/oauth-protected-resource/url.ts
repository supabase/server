/**
 * Constructs the external-facing base URL from the request,
 * considering the `X-Forwarded-*` headers set by the Supabase Edge Functions proxy.
 *
 * @internal
 */
export function getBaseUrl(req: Request): string {
  const url = new URL(req.url)
  const host = req.headers.get('X-Forwarded-Host') ?? url.hostname
  const proto =
    req.headers.get('X-Forwarded-Proto') ?? url.protocol.replace(':', '')
  const port = req.headers.get('X-Forwarded-Port') ?? url.port

  const isStandardPort =
    (proto === 'https' && port === '443') || (proto === 'http' && port === '80')

  const portSuffix = port && !isStandardPort ? `:${port}` : ''

  return `${proto}://${host}${portSuffix}`
}

/**
 * Detects the edge function name from the request path.
 * The Supabase proxy strips `/functions/v1` but keeps the function name
 * as the first path segment (e.g. `/my-fn/...` -> function name is `"my-fn"`).
 *
 * @internal
 */
export function inferFunctionName(req: Request): string | undefined {
  const url = new URL(req.url)
  const segments = url.pathname.split('/').filter(Boolean)
  return segments[0]
}

/**
 * Constructs the external-facing URL of the protected resource (the edge function itself).
 * Restores the `/functions/v1` prefix stripped by the Supabase proxy.
 *
 * @internal
 */
export function getResourceUrl(req: Request): string {
  const fn = inferFunctionName(req) ?? ''
  return `${getBaseUrl(req)}/functions/v1/${fn}`
}

/**
 * Constructs the external-facing URL for the OAuth Protected Resource
 * Metadata endpoint (RFC 9728).
 *
 * @internal
 */
export function getResourceMetadataUrl(req: Request): string {
  return `${getResourceUrl(req)}/oauth-protected-resource`
}

/**
 * Constructs the external-facing Supabase Auth URL.
 *
 * @internal
 */
export function getAuthUrl(req: Request): string {
  return `${getBaseUrl(req)}/auth/v1`
}
