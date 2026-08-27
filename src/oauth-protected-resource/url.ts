import { getEnv } from '@supabase/middleware'

import {
  Errors,
  MissingAuthorizationServerError,
  MissingResourceServerError,
} from '../errors.js'
import { AUTH_PATH_PREFIX, EDGE_FUNCTIONS_PATH_PREFIX } from './paths.js'
import { isEdgeFunctions } from './runtime.js'

/**
 * A configured URL: either a fixed value, or derived per request.
 *
 * @category Types
 */
export type UrlOption = string | ((req: Request) => string)

/**
 * Trailing path segment where a resource serves its OAuth Protected Resource
 * Metadata document (RFC 9728), as a stripping pattern.
 *
 * @internal
 */
const METADATA_SUFFIX_PATTERN = /\/oauth-protected-resource$/

/** Strips a trailing slash so URL concatenation doesn't produce `//`. @internal */
export function trimTrailingSlash(value: string): string {
  return value.endsWith('/') ? value.slice(0, -1) : value
}

/**
 * Percent-encodes `"` and `\` — invalid URL code points that would otherwise
 * break out of the RFC 9110 quoted-string in `WWW-Authenticate`. Applied to
 * every advertised URL, so the header, the metadata document, and the ctx
 * contribution agree on one spelling (RFC 9728 §3.3 requires an exact match).
 *
 * @internal
 */
export function percentEncodeQuotes(value: string): string {
  return value.replace(/["\\]/g, (c) => (c === '"' ? '%22' : '%5C'))
}

/**
 * The externally-visible origin of a Supabase Edge Function.
 *
 * `SUPABASE_PUBLIC_URL` wins when set. Otherwise the origin is assembled from
 * `X-Forwarded-Host`, `-Proto` and `-Port`, each falling back to the request
 * URL:
 *
 * - The port comes from `X-Forwarded-Port` only when the host does not already
 *   carry one.
 * - A port that is standard for the scheme (443 on https, 80 on http) is
 *   omitted.
 * - The scheme is lowercased.
 * - Header values are used as-is, never comma-split.
 *
 * `SUPABASE_URL` is not consulted — see {@link defaultAuthorizationServer}.
 *
 * @internal
 */
function edgeOrigin(req: Request): string {
  const publicUrl = getEnv('SUPABASE_PUBLIC_URL')
  if (publicUrl) return trimTrailingSlash(publicUrl)

  const url = new URL(req.url)
  const host = req.headers.get('X-Forwarded-Host') ?? url.hostname
  const proto = (
    req.headers.get('X-Forwarded-Proto') ?? url.protocol.replace(':', '')
  ).toLowerCase()
  const port = host.includes(':')
    ? ''
    : (req.headers.get('X-Forwarded-Port') ?? url.port)

  const isStandardPort =
    (proto === 'https' && port === '443') || (proto === 'http' && port === '80')

  return `${proto}://${host}${port && !isStandardPort ? `:${port}` : ''}`
}

/**
 * The external path of a Supabase Edge Function.
 *
 * With `SUPABASE_FUNCTION_SLUG` set, `/functions/v1/{slug}` — canonical, and
 * independent of the path the request arrived on. Without it, the received path
 * minus the metadata suffix, with the `/functions/v1` prefix restored (every
 * gateway fronting Edge Functions strips that prefix).
 *
 * The two forms differ only for a request at a sub-path of the function: the
 * canonical one reports the function, the reconstructed one the sub-path.
 *
 * @throws {EnvError} `MISSING_RESOURCE_SERVER` on a root path with no slug —
 * there is no function segment to restore, and a bare `/functions/v1`
 * identifies no resource.
 *
 * @internal
 */
function edgeResourcePath(req: Request): string {
  const slug = getEnv('SUPABASE_FUNCTION_SLUG')
  if (slug) return `${EDGE_FUNCTIONS_PATH_PREFIX}/${slug}`

  const received = new URL(req.url).pathname.replace(
    METADATA_SUFFIX_PATTERN,
    '',
  )
  if (received === '' || received === '/') {
    throw Errors[MissingResourceServerError]()
  }
  return `${EDGE_FUNCTIONS_PATH_PREFIX}${received}`
}

/**
 * The resource identifier to advertise when none was configured: on Edge
 * Functions, the external origin plus the external path.
 *
 * There is no environment fallback — `SUPABASE_URL` names the Supabase project,
 * not this endpoint — so off Edge Functions it throws.
 *
 * @throws {EnvError} `MISSING_RESOURCE_SERVER` off Edge Functions, or on a
 * root path with no `SUPABASE_FUNCTION_SLUG` — see {@link edgeResourcePath}.
 *
 * @internal
 */
export function defaultResourceServer(req: Request): string {
  if (!isEdgeFunctions()) throw Errors[MissingResourceServerError]()
  return `${edgeOrigin(req)}${edgeResourcePath(req)}`
}

/**
 * The Supabase Auth issuer to advertise when none was configured.
 *
 * On Edge Functions, the request's external origin plus the Auth path. Off Edge
 * Functions the app's origin is unrelated to the project's, so the environment
 * answers instead: `SUPABASE_PUBLIC_URL`, then `SUPABASE_URL`, each with the
 * Auth path appended.
 *
 * Both environment rungs sit below the Edge derivation, so on Edge Functions
 * neither can displace the origin the client used.
 *
 * @throws {EnvError} `MISSING_AUTHORIZATION_SERVER` off Edge Functions with
 * neither variable set.
 *
 * @internal
 */
export function defaultAuthorizationServer(req: Request): string {
  if (isEdgeFunctions()) return `${edgeOrigin(req)}${AUTH_PATH_PREFIX}`

  const publicUrl = getEnv('SUPABASE_PUBLIC_URL')
  if (publicUrl) return fromSupabaseUrl(publicUrl)

  const supabaseUrl = getEnv('SUPABASE_URL')
  if (supabaseUrl) return fromSupabaseUrl(supabaseUrl)

  throw Errors[MissingAuthorizationServerError]()
}

/**
 * Points `authorizationServer` at a Supabase project's Auth issuer.
 *
 * Use this off Supabase Edge Functions, where the app's own origin is unrelated
 * to the Supabase project's, so the issuer cannot be derived from the request.
 *
 * @param supabaseUrl - The project URL, e.g. `https://<ref>.supabase.co` (the
 * same value passed to `createClient()`).
 *
 * @category Middleware
 *
 * @example
 * ```ts
 * import { withOAuthProtectedResource, fromSupabaseUrl } from '@supabase/server'
 *
 * withOAuthProtectedResource(
 *   {
 *     resourceServer: (req) => new URL(req.url).origin + '/api/mcp',
 *     authorizationServer: fromSupabaseUrl('https://abc123.supabase.co'),
 *   },
 *   handler,
 * )
 * ```
 */
export function fromSupabaseUrl(supabaseUrl: string): string {
  const base = trimTrailingSlash(supabaseUrl)
  // Tolerate a value that already carries the Auth path.
  return base.endsWith(AUTH_PATH_PREFIX) ? base : `${base}${AUTH_PATH_PREFIX}`
}

/** Resolves a {@link UrlOption} against a request. @internal */
export function resolveUrlOption(
  option: UrlOption | undefined,
  req: Request,
  fallback: (req: Request) => string,
): string {
  const value = typeof option === 'function' ? option(req) : option
  return percentEncodeQuotes(trimTrailingSlash(value ?? fallback(req)))
}

/**
 * Constructs the external-facing URL of the protected resource, falling back to
 * {@link defaultResourceServer} when `resourceServer` is unset.
 *
 * @internal
 */
export function getResourceUrl(
  req: Request,
  resourceServer?: UrlOption,
): string {
  return resolveUrlOption(resourceServer, req, defaultResourceServer)
}

/**
 * Constructs the external-facing URL for the OAuth Protected Resource Metadata
 * endpoint (RFC 9728).
 *
 * @internal
 */
export function getResourceMetadataUrl(
  req: Request,
  resourceServer?: UrlOption,
): string {
  return `${getResourceUrl(req, resourceServer)}/oauth-protected-resource`
}

/**
 * Constructs the authorization server (Supabase Auth issuer) to advertise.
 *
 * @internal
 */
export function getAuthUrl(
  req: Request,
  authorizationServer?: UrlOption,
): string {
  return resolveUrlOption(authorizationServer, req, defaultAuthorizationServer)
}
