/**
 * Package identifier stamped on every error this library produces.
 *
 * Present as `source` on each error instance, as the `source` field of the JSON
 * body {@link withSupabase} returns, and as a `[@supabase/server]` prefix on
 * every `message` — so an error is traceable back here from a log line, a
 * response body, or a response header alone.
 *
 * @category Errors
 */
export const ErrorSource = '@supabase/server'

/** Prefix prepended to every error message. @internal */
const MessagePrefix = `[${ErrorSource}] `

/**
 * Response header {@link withSupabase} sets on every error response, carrying
 * the error {@link SupabaseServerError.code}.
 *
 * @category Errors
 */
export const ErrorCodeHeader = 'x-supabase-server-error'

/** @internal */
const DocsBase =
  'https://github.com/supabase/server/blob/main/docs/error-handling.md'

/**
 * Builds the documentation URL for an error code. Anchors match the
 * `### CODE` headings in `docs/error-handling.md`.
 *
 * @internal
 */
function docsFor(code: string): string {
  return `${DocsBase}#${code.toLowerCase()}`
}

/** Renders a list of names as `"a", "b"` for interpolation into messages. @internal */
function quoteList(items: readonly string[]): string {
  return items.map((item) => `"${item}"`).join(', ')
}

/**
 * Optional diagnostics attached to a {@link SupabaseServerError}.
 * @category Errors
 */
export interface SupabaseServerErrorOptions {
  /** Actionable next step for whoever has to fix this. */
  hint?: string

  /**
   * Structured, non-sensitive diagnostics. Never contains key values, token
   * payloads, or any other secret material.
   */
  details?: Record<string, unknown>

  /** Override the generated documentation URL. */
  docs?: string

  /** Underlying error, when this one wraps another. */
  cause?: unknown
}

/**
 * Serializable form of a {@link SupabaseServerError} — the exact JSON body
 * {@link withSupabase} returns on failure.
 *
 * @category Errors
 */
export interface ErrorPayload {
  /** Always `"@supabase/server"`. Identifies which library produced the error. */
  source: typeof ErrorSource

  /** Machine-readable error code, also sent as the `x-supabase-server-error` header. */
  code: string

  /** Human-readable description, prefixed with `[@supabase/server]`. */
  message: string

  /** Actionable next step. Omitted when there isn't a useful one. */
  hint?: string

  /** Documentation URL for this specific code. */
  docs: string

  /** Structured, non-sensitive diagnostics. Omitted when there are none. */
  details?: Record<string, unknown>
}

/**
 * Base class for every error `@supabase/server` produces.
 *
 * Catch this to handle anything originating from this library, regardless of
 * whether it's an {@link EnvError} or an {@link AuthError}:
 *
 * @example Catching any library error
 * ```ts
 * import { SupabaseServerError } from '@supabase/server'
 *
 * try {
 *   const supabase = createAdminClient()
 * } catch (e) {
 *   if (e instanceof SupabaseServerError) {
 *     console.error(e.code, e.message, e.hint, e.docs)
 *     return Response.json(e.toJSON(), { status: e.status })
 *   }
 *   throw e
 * }
 * ```
 *
 * @category Errors
 */
export abstract class SupabaseServerError extends Error {
  /** Always `"@supabase/server"`. @see {@link ErrorSource} */
  readonly source = ErrorSource

  /** HTTP status code appropriate for this error. */
  abstract readonly status: number

  /** Machine-readable error code. */
  readonly code: string

  /** Actionable next step, when one applies. */
  readonly hint?: string

  /** Documentation URL for this error's `code`. */
  readonly docs: string

  /**
   * Structured, non-sensitive diagnostics — accepted auth modes, which
   * credential headers were present, configured key *names*, JWT header
   * fields. Never key values or token payloads.
   */
  readonly details?: Record<string, unknown>

  constructor(
    message: string,
    code: string,
    options?: SupabaseServerErrorOptions,
  ) {
    // Prefix so provenance survives even when only `message` is logged or
    // re-thrown by a framework. Guarded so re-wrapping doesn't double-prefix.
    super(
      message.startsWith(MessagePrefix) ? message : MessagePrefix + message,
      options && 'cause' in options ? { cause: options.cause } : undefined,
    )
    this.name = 'SupabaseServerError'
    this.code = code
    this.docs = options?.docs ?? docsFor(code)
    if (options?.hint) this.hint = options.hint
    if (options?.details) this.details = options.details
  }

  /**
   * Returns the wire format — also used implicitly by `JSON.stringify`, so
   * logging the error yields the full diagnostics rather than `{}`.
   */
  toJSON(): ErrorPayload {
    return {
      source: this.source,
      code: this.code,
      message: this.message,
      ...(this.hint ? { hint: this.hint } : {}),
      docs: this.docs,
      ...(this.details ? { details: this.details } : {}),
    }
  }
}

/**
 * Thrown when a required environment variable is missing or malformed.
 *
 * Always has `status: 500` — environment errors are server-side configuration issues.
 *
 * @example Catching an EnvError
 * ```ts
 * import { EnvError } from '@supabase/server'
 *
 * try {
 *   const client = createAdminClient()
 * } catch (e) {
 *   if (e instanceof EnvError) {
 *     console.error(`[${e.code}] ${e.message}\n${e.hint}`)
 *     // → "[MISSING_SUPABASE_URL] [@supabase/server] SUPABASE_URL is required but not set."
 *     //   "Set SUPABASE_URL to your project URL (https://<project-ref>.supabase.co), …"
 *   }
 * }
 * ```
 *
 * @category Errors
 */
export class EnvError extends SupabaseServerError {
  /** Always `500` — environment errors are server-side issues. */
  readonly status = 500

  /**
   * @param message - Human-readable description. Prefixed with `[@supabase/server]`.
   * @param code - Machine-readable code. @see {@link EnvGenericError}, {@link MissingSupabaseURLError},
   *   {@link MissingPublishableKeyError}, {@link MissingDefaultPublishableKeyError},
   *   {@link MissingSecretKeyError}, {@link MissingDefaultSecretKeyError}
   * @param options - Optional `hint`, `details`, `docs`, and `cause`.
   */
  constructor(
    message: string,
    code = EnvGenericError,
    options?: SupabaseServerErrorOptions,
  ) {
    super(message, code, options)
    this.name = 'EnvError'
  }
}

/**
 * Generic environment error code.
 * @category Errors
 */
export const EnvGenericError = 'ENV_ERROR'

/**
 * `SUPABASE_URL` is not set.
 * @category Errors
 */
export const MissingSupabaseURLError = 'MISSING_SUPABASE_URL'

/**
 * Named publishable key not found in `SUPABASE_PUBLISHABLE_KEYS`.
 * @category Errors
 */
export const MissingPublishableKeyError = 'MISSING_PUBLISHABLE_KEY'

/**
 * No default publishable key found.
 * @category Errors
 */
export const MissingDefaultPublishableKeyError =
  'MISSING_DEFAULT_PUBLISHABLE_KEY'

/**
 * Named secret key not found in `SUPABASE_SECRET_KEYS`.
 * @category Errors
 */
export const MissingSecretKeyError = 'MISSING_SECRET_KEY'

/**
 * No default secret key found.
 * @category Errors
 */
export const MissingDefaultSecretKeyError = 'MISSING_DEFAULT_SECRET_KEY'

/**
 * `withOAuthProtectedResource` has no `resourceServer` and cannot derive one.
 * @category Errors
 */
export const MissingResourceServerError = 'MISSING_RESOURCE_SERVER'

/**
 * `withOAuthProtectedResource` has no `authorizationServer` and cannot derive one.
 * @category Errors
 */
export const MissingAuthorizationServerError = 'MISSING_AUTHORIZATION_SERVER'

/**
 * No Postgres connection string is configured, so the `withPostgresClient` /
 * `withPostgresAdminClient` middleware cannot connect.
 *
 * @category Errors
 */
export const MissingConnectionStringError = 'MISSING_CONNECTION_STRING'

/**
 * Describes the configured key names for a hint without revealing key values.
 * @internal
 */
function configuredNames(available?: readonly string[]): string {
  if (!available || available.length === 0) return 'None are configured.'
  return `Configured names: ${quoteList(available)}.`
}

const EnvErrorMap = {
  [MissingSupabaseURLError]: (): EnvError =>
    new EnvError(
      'SUPABASE_URL is required but not set.',
      MissingSupabaseURLError,
      {
        hint:
          'Set SUPABASE_URL to your project URL (https://<project-ref>.supabase.co), ' +
          'or pass `env.url`. A local Supabase CLI stack uses http://localhost:54321.',
      },
    ),

  [MissingSecretKeyError]: (
    name: string,
    availableKeyNames?: readonly string[],
  ): EnvError =>
    new EnvError(
      `No "${name}" secret key found. ${configuredNames(availableKeyNames)}`,
      MissingSecretKeyError,
      {
        hint:
          `Add a "${name}" entry to SUPABASE_SECRET_KEYS — a JSON object of name → key, ` +
          `e.g. {"${name}":"sb_secret_…"} — or pass \`env.secretKeys\`.`,
        details: {
          requestedKeyName: name,
          configuredKeyNames: availableKeyNames ?? [],
        },
      },
    ),

  [MissingDefaultSecretKeyError]: (
    availableKeyNames?: readonly string[],
  ): EnvError =>
    new EnvError(
      `No default secret key found. ${configuredNames(availableKeyNames)}`,
      MissingDefaultSecretKeyError,
      {
        hint:
          'Set SUPABASE_SECRET_KEY, or add a "default" entry to SUPABASE_SECRET_KEYS ' +
          '(a JSON object of name → key), or pass `env.secretKeys`.',
        details: { configuredKeyNames: availableKeyNames ?? [] },
      },
    ),

  [MissingPublishableKeyError]: (
    name: string,
    availableKeyNames?: readonly string[],
  ): EnvError =>
    new EnvError(
      `No "${name}" publishable key found. ${configuredNames(availableKeyNames)}`,
      MissingPublishableKeyError,
      {
        hint:
          `Add a "${name}" entry to SUPABASE_PUBLISHABLE_KEYS — a JSON object of name → key, ` +
          `e.g. {"${name}":"sb_publishable_…"} — or pass \`env.publishableKeys\`.`,
        details: {
          requestedKeyName: name,
          configuredKeyNames: availableKeyNames ?? [],
        },
      },
    ),

  [MissingDefaultPublishableKeyError]: (
    availableKeyNames?: readonly string[],
  ): EnvError =>
    new EnvError(
      `No default publishable key found. ${configuredNames(availableKeyNames)}`,
      MissingDefaultPublishableKeyError,
      {
        hint:
          'Set SUPABASE_PUBLISHABLE_KEY, or add a "default" entry to SUPABASE_PUBLISHABLE_KEYS ' +
          '(a JSON object of name → key), or pass `env.publishableKeys`.',
        details: { configuredKeyNames: availableKeyNames ?? [] },
      },
    ),

  [MissingResourceServerError]: (): EnvError =>
    new EnvError(
      'resourceServer is required outside Supabase Edge Functions and could not be derived.',
      MissingResourceServerError,
      {
        hint:
          'Pass it to withOAuthProtectedResource(), e.g. ' +
          "{ resourceServer: (req) => new URL(req.url).origin + '/api/mcp' }. On Edge Functions it " +
          'is derived from the request instead.',
      },
    ),

  [MissingAuthorizationServerError]: (): EnvError =>
    new EnvError(
      'authorizationServer is required outside Supabase Edge Functions and could not be derived.',
      MissingAuthorizationServerError,
      {
        hint:
          'Pass it to withOAuthProtectedResource() — use ' +
          "fromSupabaseUrl('https://<project-ref>.supabase.co') for Supabase Auth — or set " +
          'SUPABASE_PUBLIC_URL or SUPABASE_URL.',
      },
    ),

  [MissingConnectionStringError]: (
    /** The middleware that needed the connection string, for a precise hint. */
    middleware: string,
  ): EnvError =>
    new EnvError(
      'A Postgres connection string is required, and none is configured.',
      MissingConnectionStringError,
      {
        hint:
          `Set SUPABASE_DB_URL, or pass \`connectionString\` to ${middleware}(). Supabase Edge ` +
          'Functions provide SUPABASE_DB_URL automatically; elsewhere, copy it from Project ' +
          'Settings → Database → Connection string.',
        details: { middleware },
      },
    ),
}

/**
 * Thrown when authentication or authorization fails.
 *
 * Carries an HTTP `status` code suitable for returning directly in a response
 * (`401` when the request's credentials are at fault, `500` when the server is
 * misconfigured and could not have authenticated anyone).
 *
 * @example Catching an AuthError
 * ```ts
 * import { createSupabaseContext } from '@supabase/server'
 *
 * const { data: ctx, error } = await createSupabaseContext(request, { auth: 'user' })
 * if (error) {
 *   // error is an AuthError — `toJSON()` includes source, code, message, hint, docs, details
 *   return Response.json(error.toJSON(), { status: error.status })
 * }
 * ```
 *
 * @category Errors
 */
export class AuthError extends SupabaseServerError {
  /**
   * HTTP status code.
   *
   * - `401` — The request's credentials are at fault ({@link MissingCredentialsError},
   *   {@link InvalidApiKeyError}, {@link InvalidJwtError}).
   * - `500` — The server is misconfigured ({@link JwksNotConfiguredError},
   *   {@link NoKeysConfiguredError}, {@link JwksFetchFailedError},
   *   {@link CreateSupabaseClientError}).
   */
  readonly status: number

  /**
   * @param message - Human-readable description. Prefixed with `[@supabase/server]`.
   * @param code - Machine-readable code. @see {@link AuthGenericError}, {@link MissingCredentialsError},
   *   {@link InvalidApiKeyError}, {@link InvalidJwtError}, {@link InvalidCredentialsError},
   *   {@link JwksNotConfiguredError}, {@link JwksFetchFailedError},
   *   {@link NoKeysConfiguredError}, {@link CreateSupabaseClientError}
   * @param status - HTTP status. Defaults to `401`.
   * @param options - Optional `hint`, `details`, `docs`, and `cause`.
   */
  constructor(
    message: string,
    code = AuthGenericError,
    status = 401,
    options?: SupabaseServerErrorOptions,
  ) {
    super(message, code, options)
    this.name = 'AuthError'
    this.status = status
  }
}

/**
 * Generic authentication error code.
 * @category Errors
 */
export const AuthGenericError = 'AUTH_ERROR'

/**
 * The request carried no credentials at all — neither an `apikey` header nor
 * an `Authorization: Bearer` token — and no accepted auth mode allows that.
 *
 * @category Errors
 */
export const MissingCredentialsError = 'MISSING_CREDENTIALS'

/**
 * An `apikey` header was present but matched none of the keys configured for
 * the accepted auth modes.
 *
 * @category Errors
 */
export const InvalidApiKeyError = 'INVALID_API_KEY'

/**
 * A JWT was present in the `Authorization` header but failed verification.
 * `details.jwt` and the message carry the specific reason (expired, bad
 * signature, unknown `kid`, malformed, no `sub`).
 *
 * @category Errors
 */
export const InvalidJwtError = 'INVALID_JWT'

/**
 * Generic credential failure. Retained as the fallback code for cases that
 * don't match a more specific one.
 *
 * @remarks Prior to v1.5 this was the only code {@link withSupabase} ever
 * returned for a failed request. Prefer matching on the specific codes —
 * {@link MissingCredentialsError}, {@link InvalidApiKeyError},
 * {@link InvalidJwtError} — which now cover nearly every real failure.
 *
 * @category Errors
 */
export const InvalidCredentialsError = 'INVALID_CREDENTIALS'

/**
 * Auth mode `"user"` was requested and a JWT was supplied, but no JWKS is
 * configured — so the token cannot be verified. Server misconfiguration
 * (`status: 500`), not a bad request.
 *
 * @category Errors
 */
export const JwksNotConfiguredError = 'JWKS_NOT_CONFIGURED'

/**
 * The remote JWKS endpoint could not be fetched or returned something
 * unusable. Server-side / upstream failure (`status: 500`), not a bad request.
 *
 * @category Errors
 */
export const JwksFetchFailedError = 'JWKS_FETCH_FAILED'

/**
 * An `"publishable"` or `"secret"` auth mode was requested but no keys of that
 * kind are configured, so the mode could never match. Server
 * misconfiguration (`status: 500`).
 *
 * @category Errors
 */
export const NoKeysConfiguredError = 'NO_KEYS_CONFIGURED'

/**
 * Failed to create a Supabase client after auth succeeded.
 * @category Errors
 */
export const CreateSupabaseClientError = 'CREATE_SUPABASE_CLIENT_ERROR'

/**
 * The caller's verified `role` claim names a Postgres role the middleware
 * will not assume — either one that would bypass RLS, or one it does not
 * support yet. Returned by `withPostgresClient` instead of silently running
 * the query as `anon`.
 * @category Errors
 */
export const UnsupportedRoleError = 'UNSUPPORTED_ROLE'

/**
 * How an `apikey` header value was classified by its public prefix. Used in
 * diagnostics so a format mismatch can be reported without echoing the key.
 *
 * @category Errors
 */
export type ApiKeyFormat =
  | 'absent'
  | 'publishable'
  | 'secret'
  | 'legacy-jwt'
  | 'unrecognized'

/**
 * Non-sensitive summary of the credentials a request carried.
 * @category Errors
 */
export interface ReceivedCredentials {
  /**
   * What the `Authorization` header carried.
   *
   * - `'bearer'` — a bearer token that looks like a JWT
   * - `'api-key'` — an `sb_*` API key, which the Supabase SDK forwards here
   *   alongside the `apikey` header; not a user token
   * - `'non-bearer-scheme'` — present but unusable (wrong scheme, wrong
   *   casing, bare value, empty token)
   * - `'absent'` — no header
   */
  authorization: 'bearer' | 'api-key' | 'non-bearer-scheme' | 'absent'

  /** The `apikey` header classified by prefix. Never the value itself. */
  apikey: ApiKeyFormat
}

/**
 * Everything the auth pipeline knows about a failed attempt, minus anything
 * secret. Used to build messages, hints, and `details`.
 *
 * @category Errors
 */
export interface AuthFailureContext {
  /** Auth modes that were attempted, in the order they were tried. */
  authModes: readonly string[]

  /** Which credential headers the request carried. */
  received: ReceivedCredentials

  /**
   * Names (never values) of the keys configured for the attempted modes.
   * Omitted for modes that don't use API keys.
   */
  configuredKeyNames?: Record<string, readonly string[]>
}

/**
 * Maps an auth mode to the header the caller must send for it to match.
 * @internal
 */
function credentialForMode(mode: string): string | null {
  if (mode === 'user') return 'Authorization: Bearer <jwt>'
  if (mode === 'publishable' || mode.startsWith('publishable:'))
    return 'apikey: <publishable key>'
  if (mode === 'secret' || mode.startsWith('secret:'))
    return 'apikey: <secret key>'
  return null
}

/**
 * Builds a "send one of these" hint from the attempted auth modes.
 * @internal
 */
function sendOneOfHint(authModes: readonly string[]): string | undefined {
  const options = [
    ...new Set(
      authModes
        .map((mode) => {
          const credential = credentialForMode(mode)
          return credential ? `${credential} (for auth mode "${mode}")` : null
        })
        .filter((entry): entry is string => entry !== null),
    ),
  ]
  if (options.length === 0) return undefined
  const lead = options.length > 1 ? 'Send one of' : 'Send'
  return `${lead}: ${options.join('; ')}.`
}

/** Human label for a key format, for use in hints. @internal */
const ApiKeyFormatLabel: Record<ApiKeyFormat, string> = {
  absent: 'no apikey header',
  publishable: 'a publishable key (sb_publishable_…)',
  secret: 'a secret key (sb_secret_…)',
  'legacy-jwt': 'a legacy JWT-style key (eyJ…)',
  unrecognized: 'a value in an unrecognized format',
}

/**
 * Explains an API key rejection, favouring the format-mismatch case — sending
 * a secret key to a publishable-only endpoint (or vice versa) is a far more
 * common mistake than a genuinely wrong key.
 *
 * @internal
 */
function apiKeyHint(context: AuthFailureContext): string {
  const { authModes, received } = context
  const keyModes = authModes.filter((mode) =>
    credentialForMode(mode)?.startsWith('apikey'),
  )
  const acceptsPublishable = keyModes.some((mode) =>
    mode.startsWith('publishable'),
  )
  const acceptsSecret = keyModes.some((mode) => mode.startsWith('secret'))

  if (received.apikey === 'legacy-jwt') {
    return (
      'The apikey looks like a legacy JWT-based key (anon / service_role). ' +
      '@supabase/server expects the newer API key format — sb_publishable_… or sb_secret_…. ' +
      'Find them under Project Settings → API Keys.'
    )
  }
  if (received.apikey === 'secret' && acceptsPublishable && !acceptsSecret) {
    return (
      'You sent a secret key, but this endpoint only accepts publishable keys. ' +
      'Send a sb_publishable_… key, or add "secret" to `auth` if server-to-server calls should be allowed.'
    )
  }
  if (
    received.apikey === 'publishable' &&
    acceptsSecret &&
    !acceptsPublishable
  ) {
    return (
      'You sent a publishable key, but this endpoint only accepts secret keys. ' +
      'Send a sb_secret_… key, or add "publishable" to `auth` if client-facing calls should be allowed.'
    )
  }
  if (received.apikey === 'unrecognized') {
    return (
      `The apikey header held ${ApiKeyFormatLabel.unrecognized} — Supabase API keys start with ` +
      'sb_publishable_ or sb_secret_. Copy the key from Project Settings → API Keys.'
    )
  }

  // Name only the key kinds the endpoint actually accepts — pointing at
  // SUPABASE_SECRET_KEYS for a publishable-only endpoint sends people the
  // wrong way.
  const kinds = Object.entries(context.configuredKeyNames ?? {})
  const names = kinds
    .map(
      ([kind, keyNames]) =>
        `${kind}: ${keyNames.length ? quoteList(keyNames) : 'none configured'}`,
    )
    .join('; ')
  const envVars = kinds
    .map(([kind]) => `SUPABASE_${kind.toUpperCase()}_KEY(S)`)
    .join(' / ')
  return (
    `The key was well-formed but matched no configured key${names ? ` (${names})` : ''}. ` +
    `Keys come from ${envVars || 'the SUPABASE_*_KEY(S) variables'}, or the \`env\` option. ` +
    'Check you are pointing at the right Supabase project.'
  )
}

const AuthErrorMap = {
  [MissingCredentialsError]: (context: AuthFailureContext): AuthError => {
    const { authorization } = context.received
    return new AuthError(
      `No usable credentials found on the request. This endpoint accepts auth mode(s): ${quoteList(context.authModes)}.`,
      MissingCredentialsError,
      401,
      {
        hint: [
          authorization === 'non-bearer-scheme' &&
            'The Authorization header was present but did not use the `Bearer` scheme, so no token was read.',
          authorization === 'api-key' &&
            'The Authorization header carried an sb_* API key, not a user JWT. API keys belong in the `apikey` header; ' +
              'the Supabase SDK sends them in both, which is why this is easy to miss.',
          sendOneOfHint(context.authModes),
        ]
          .filter(Boolean)
          .join(' '),
        details: {
          acceptedAuthModes: context.authModes,
          received: context.received,
        },
      },
    )
  },

  [InvalidApiKeyError]: (context: AuthFailureContext): AuthError =>
    new AuthError(
      `The apikey header matched no key configured for auth mode(s): ${quoteList(context.authModes)}.`,
      InvalidApiKeyError,
      401,
      {
        hint: apiKeyHint(context),
        details: {
          acceptedAuthModes: context.authModes,
          received: context.received,
          ...(context.configuredKeyNames
            ? { configuredKeyNames: context.configuredKeyNames }
            : {}),
        },
      },
    ),

  // Context is partial because the claims middleware verify a JWT without an
  // auth-mode chain to report — they only ever accept a user token.
  [InvalidJwtError]: (
    context: Partial<AuthFailureContext> & {
      /** Why verification failed, in plain language. */
      reason: string
      /** How to fix it. */
      hint: string
      /** Non-sensitive JWT header fields (`alg`, `kid`). Never claim values. */
      jwt?: Record<string, unknown>
      /** The underlying `jose` error, when there was one. */
      cause?: unknown
    },
  ): AuthError =>
    new AuthError(
      `The JWT in the Authorization header failed verification: ${context.reason}.`,
      InvalidJwtError,
      401,
      {
        hint: context.hint,
        details: {
          ...(context.authModes
            ? { acceptedAuthModes: context.authModes }
            : {}),
          ...(context.received ? { received: context.received } : {}),
          ...(context.jwt ? { jwt: context.jwt } : {}),
        },
        cause: context.cause,
      },
    ),

  // Context is partial because the claims middleware reach this without an
  // auth-mode chain; `middleware` names the option to pass instead of `env.jwks`.
  [JwksNotConfiguredError]: (
    context: Partial<AuthFailureContext> & { middleware?: string } = {},
  ): AuthError =>
    new AuthError(
      'A JWT was provided but no JWKS is configured, so it cannot be verified. ' +
        'This is a server configuration problem, not a problem with the request.',
      JwksNotConfiguredError,
      500,
      {
        hint:
          'Set SUPABASE_JWKS_URL (e.g. https://<project-ref>.supabase.co/auth/v1/.well-known/jwks.json) ' +
          'or SUPABASE_JWKS (inline JSON), or pass ' +
          (context.middleware
            ? `\`jwks\` to ${context.middleware}()`
            : '`env.jwks`') +
          '. Note that a malformed value resolves to null rather than erroring: SUPABASE_JWKS must be ' +
          'valid JSON, and SUPABASE_JWKS_URL must be https (plain http is only allowed for localhost).',
        details: {
          ...(context.authModes
            ? { acceptedAuthModes: context.authModes }
            : {}),
          ...(context.received ? { received: context.received } : {}),
          ...(context.middleware ? { middleware: context.middleware } : {}),
        },
      },
    ),

  [JwksFetchFailedError]: (
    context: Partial<AuthFailureContext> & {
      reason: string
      cause?: unknown
    },
  ): AuthError =>
    new AuthError(
      `The remote JWKS could not be fetched, so the JWT could not be verified: ${context.reason}. ` +
        'This is a server-side or upstream failure, not a problem with the request.',
      JwksFetchFailedError,
      500,
      {
        hint:
          'Check that SUPABASE_JWKS_URL points at a reachable JWKS endpoint and that the server has ' +
          'outbound network access to it. The endpoint must return 200 with a JSON `{ "keys": [...] }` body.',
        details: {
          ...(context.authModes
            ? { acceptedAuthModes: context.authModes }
            : {}),
          ...(context.received ? { received: context.received } : {}),
        },
        cause: context.cause,
      },
    ),

  [NoKeysConfiguredError]: (
    context: AuthFailureContext & {
      /** The full auth mode that could never match, e.g. `"publishable:mobile"`. */
      mode: string
      /** Which key set the mode draws from. */
      keyKind: 'publishable' | 'secret'
    },
  ): AuthError => {
    const envVar =
      context.keyKind === 'publishable'
        ? 'SUPABASE_PUBLISHABLE_KEY / SUPABASE_PUBLISHABLE_KEYS'
        : 'SUPABASE_SECRET_KEY / SUPABASE_SECRET_KEYS'
    const configured = context.configuredKeyNames?.[context.keyKind] ?? []
    return new AuthError(
      `Auth mode "${context.mode}" was requested but no matching ${context.keyKind} key is configured, ` +
        'so the mode could never match any request. This is a server configuration problem, not a ' +
        'problem with the request.',
      NoKeysConfiguredError,
      500,
      {
        hint:
          `${configuredNames(configured)} Set ${envVar} (the plural form is a JSON object of ` +
          `name → key), or pass \`env.${context.keyKind}Keys\`.`,
        details: {
          acceptedAuthModes: context.authModes,
          received: context.received,
          mode: context.mode,
          keyKind: context.keyKind,
          ...(context.configuredKeyNames
            ? { configuredKeyNames: context.configuredKeyNames }
            : {}),
        },
      },
    )
  },

  [InvalidCredentialsError]: (context?: AuthFailureContext): AuthError =>
    new AuthError(
      context
        ? `No credential matched any of the accepted auth mode(s): ${quoteList(context.authModes)}.`
        : 'No credential matched any accepted auth mode.',
      InvalidCredentialsError,
      401,
      {
        hint: context
          ? sendOneOfHint(context.authModes)
          : 'Check that the request carries a credential for one of the accepted auth modes.',
        details: context
          ? {
              acceptedAuthModes: context.authModes,
              received: context.received,
            }
          : undefined,
      },
    ),

  [CreateSupabaseClientError]: (options?: { cause?: unknown }): AuthError =>
    new AuthError(
      'Authentication succeeded but the Supabase client could not be created.',
      CreateSupabaseClientError,
      500,
      {
        hint:
          'This is almost always a missing or malformed SUPABASE_URL or API key. The underlying ' +
          'error is attached as `cause` — log it to see which value is at fault.',
        cause: options?.cause,
      },
    ),

  [UnsupportedRoleError]: (context: {
    /** The `role` claim as it arrived, whatever its type. */
    requestedRole: unknown
    /** Roles the middleware will assume. */
    supportedRoles: readonly string[]
  }): AuthError => {
    const { requestedRole, supportedRoles } = context
    const supported = quoteList(supportedRoles)

    const [reason, hint] =
      requestedRole === 'service_role'
        ? [
            'the caller\'s token carries the "service_role" role, which withPostgresClient will not assume',
            'That role bypasses RLS — the guarantee this middleware exists to provide. If bypassing ' +
              "RLS is intended, compose withPostgresAdminClient from '@supabase/server/middleware/postgres-admin'.",
          ]
        : typeof requestedRole === 'string'
          ? [
              `the caller's token carries the role "${requestedRole}", which withPostgresClient does not support yet`,
              `It assumes ${supported} only. Custom roles are on the roadmap; until then, issue tokens ` +
                'with one of the supported roles.',
            ]
          : [
              `the caller's token has a "role" claim that is not a string (${JSON.stringify(requestedRole)})`,
              `withPostgresClient assumes ${supported} only and will not guess what a malformed claim ` +
                'meant. Check how the token is minted.',
            ]

    return new AuthError(
      `Cannot select a Postgres role: ${reason}.`,
      UnsupportedRoleError,
      500,
      {
        hint,
        details: { requestedRole, supportedRoles },
      },
    )
  },
}

/**
 * Returns a copy of `error` carrying an extra leading hint sentence and merged
 * `details`. Lets an outer layer add diagnostics the inner layer could not see —
 * {@link core.verifyAuth} can inspect the raw `Authorization` header, while
 * {@link core.verifyCredentials} only receives already-extracted
 * {@link Credentials}.
 *
 * @internal
 */
export function withExtraDiagnostics(
  error: AuthError,
  extra: { hint?: string; details?: Record<string, unknown> },
): AuthError {
  return new AuthError(error.message, error.code, error.status, {
    hint: [extra.hint, error.hint].filter(Boolean).join(' ') || undefined,
    details:
      error.details || extra.details
        ? { ...error.details, ...extra.details }
        : undefined,
    docs: error.docs,
    cause: error.cause,
  })
}

/**
 * Factory map for all error types. Keyed by error code constant, each entry
 * returns a pre-configured {@link EnvError} or {@link AuthError} complete with
 * `hint`, `docs`, and `details`.
 *
 * @example Throwing typed errors
 * ```ts
 * throw Errors[MissingSupabaseURLError]()
 * throw Errors[MissingPublishableKeyError]('mobile', ['default', 'web'])
 * ```
 *
 * @category Errors
 */
export const Errors = {
  ...EnvErrorMap,
  ...AuthErrorMap,
}
