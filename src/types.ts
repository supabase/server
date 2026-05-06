import type {
  SupabaseClient,
  SupabaseClientOptions,
} from '@supabase/supabase-js'

/**
 * Authentication mode that determines what credentials a request must provide.
 *
 * - `"none"` — No credentials required. Every request is accepted.
 * - `"publishable"` — Requires a valid publishable key in the `apikey` header.
 * - `"secret"` — Requires a valid secret key in the `apikey` header (timing-safe comparison).
 * - `"user"` — Requires a valid JWT in the `Authorization: Bearer <token>` header.
 *
 * @example
 * ```ts
 * // Single mode
 * withSupabase({ auth: 'user' }, handler)
 *
 * // Multiple modes — the first match wins.
 * // A mode is tried only when its credential is present; a JWT that is
 * // present but fails verification rejects immediately rather than falling
 * // through to the next mode.
 * withSupabase({ auth: ['user', 'publishable'] }, handler)
 * ```
 */
export type AuthMode = 'none' | 'publishable' | 'secret' | 'user'

/**
 * @deprecated Use {@link AuthMode} instead. Will be removed in a future major release.
 */
export type Allow = AuthMode

/**
 * Extended auth mode that supports targeting a specific named key.
 *
 * Use the colon syntax (`"publishable:web_app"`) to require a specific named key
 * from the `SUPABASE_PUBLISHABLE_KEYS` or `SUPABASE_SECRET_KEYS` JSON object.
 * Use `"publishable:*"` or `"secret:*"` to accept any key in the set.
 *
 * @example
 * ```ts
 * // Accept only the "mobile" publishable key
 * withSupabase({ auth: 'publishable:mobile' }, handler)
 *
 * // Accept any secret key
 * withSupabase({ auth: 'secret:*' }, handler)
 *
 * // Mix named keys with other modes
 * withSupabase({ auth: ['user', 'publishable:web_app'] }, handler)
 * ```
 */
export type AuthModeWithKey =
  | AuthMode
  | `publishable:${string}`
  | `secret:${string}`

/**
 * @deprecated Use {@link AuthModeWithKey} instead. Will be removed in a future major release.
 */
export type AllowWithKey = AuthModeWithKey

/**
 * Resolved Supabase environment configuration.
 *
 * Holds the project URL, API keys, and JWKS needed by every other primitive.
 * Typically resolved automatically from environment variables by {@link resolveEnv},
 * but can be passed explicitly via the `env` option.
 *
 * @see {@link resolveEnv} for how each field maps to environment variables.
 */
export interface SupabaseEnv {
  /** Supabase project URL (e.g. `"https://<ref>.supabase.co"`). Sourced from `SUPABASE_URL`. */
  url: string

  /**
   * Named publishable keys. Sourced from `SUPABASE_PUBLISHABLE_KEYS` (JSON object)
   * or `SUPABASE_PUBLISHABLE_KEY` (single key, stored as `{ default: "<value>" }`).
   */
  publishableKeys: Record<string, string>

  /**
   * Named secret keys. Sourced from `SUPABASE_SECRET_KEYS` (JSON object)
   * or `SUPABASE_SECRET_KEY` (single key, stored as `{ default: "<value>" }`).
   */
  secretKeys: Record<string, string>

  /**
   * JSON Web Key Set used for JWT verification. Sourced from `SUPABASE_JWKS`.
   * Accepts both `{ keys: [...] }` and bare `[...]` array formats.
   * `null` when no JWKS is configured (JWT verification will be unavailable).
   */
  jwks: JsonWebKeySet | null
}

/**
 * A JSON Web Key Set as defined by RFC 7517.
 *
 * @see https://datatracker.ietf.org/doc/html/rfc7517
 */
export interface JsonWebKeySet {
  /** Array of JSON Web Keys. */
  keys: JsonWebKey[]
}

/**
 * Raw credentials extracted from an incoming HTTP request.
 *
 * Produced by {@link extractCredentials} from the `Authorization` and `apikey` headers.
 *
 * @see {@link extractCredentials}
 */
export interface Credentials {
  /** Bearer token from the `Authorization: Bearer <token>` header, or `null` if absent. */
  token: string | null

  /** API key from the `apikey` header, or `null` if absent. */
  apikey: string | null
}

/**
 * Result of credential verification.
 *
 * Contains the resolved auth mode, the verified token (for `"user"` mode),
 * decoded JWT claims, and the matched key name (for `"public"` / `"secret"` modes).
 *
 * @see {@link verifyCredentials}
 * @see {@link verifyAuth}
 */
export interface AuthResult {
  /** The auth mode that was successfully matched. */
  authMode: AuthMode

  /** The verified JWT, or `null` for non-user auth modes. */
  token: string | null

  /** Normalized user identity derived from the JWT, or `null` when no JWT is present. */
  userClaims: UserClaims | null

  /** Raw JWT payload, or `null` when no JWT is present. */
  jwtClaims: JWTClaims | null

  /** Name of the matched key (e.g. `"default"`, `"mobile"`), or `null` for `"user"` / `"always"` modes. */
  keyName?: string | null
}

/**
 * Standard JWT claims as defined by RFC 7519, extended with Supabase-specific fields.
 *
 * This is the raw JWT payload — use {@link UserClaims} for a normalized, camelCase view.
 *
 * @see https://datatracker.ietf.org/doc/html/rfc7519#section-4.1
 */
export interface JWTClaims {
  /** Subject — the user's unique ID. */
  sub: string

  /** Issuer — typically your Supabase project URL. */
  iss?: string

  /** Audience — who the token is intended for. */
  aud?: string | string[]

  /** Expiration time (seconds since epoch). */
  exp?: number

  /** Issued at (seconds since epoch). */
  iat?: number

  /** Supabase role (e.g. `"authenticated"`, `"anon"`). */
  role?: string

  /** User's email address from Supabase Auth. */
  email?: string

  /** Application-level metadata set via Supabase Auth admin APIs. */
  app_metadata?: Record<string, unknown>

  /** User-editable metadata set via Supabase Auth. */
  user_metadata?: Record<string, unknown>

  /** Additional custom claims. */
  [key: string]: unknown
}

/**
 * Normalized, camelCase view of the authenticated user's identity.
 *
 * Derived from {@link JWTClaims}. For the full Supabase `User` object
 * (including email confirmation status, providers, etc.), call
 * `supabase.auth.getUser()` using the context client.
 */
export interface UserClaims {
  /** User's unique ID (same as `JWTClaims.sub`). */
  id: string

  /** Supabase role (e.g. `"authenticated"`). */
  role?: string

  /** User's email address. */
  email?: string

  /** Application-level metadata (e.g. roles, permissions). */
  appMetadata?: Record<string, unknown>

  /** User-editable profile metadata (e.g. display name, avatar). */
  userMetadata?: Record<string, unknown>
}

/**
 * Configuration for {@link withSupabase} and {@link createSupabaseContext}.
 *
 * Controls which auth modes are accepted, environment overrides, and CORS behavior.
 *
 * @example
 * ```ts
 * // Require authenticated users, auto-CORS enabled (default)
 * const config: WithSupabaseConfig = { auth: 'user' }
 *
 * // Accept users or service-to-service calls, custom CORS headers
 * const config: WithSupabaseConfig = {
 *   auth: ['user', 'secret'],
 *   cors: { 'Access-Control-Allow-Origin': 'https://myapp.com' },
 * }
 *
 * // No auth required, CORS disabled
 * const config: WithSupabaseConfig = { auth: 'none', cors: false }
 * ```
 */
export interface WithSupabaseConfig {
  /**
   * Auth mode(s) to accept. Modes are tried in order — the first match wins.
   * A mode falls through only when its credential is absent; a present-but-invalid
   * JWT short-circuits the chain with `InvalidCredentialsError`.
   *
   * @defaultValue `"user"`
   */
  auth?: AuthModeWithKey | AuthModeWithKey[]

  /**
   * @deprecated Use {@link WithSupabaseConfig.auth} instead. The `allow` option
   * is kept for backward compatibility and will be removed in a future major release.
   * When both `auth` and `allow` are provided, `auth` takes precedence.
   */
  allow?: AuthModeWithKey | AuthModeWithKey[]

  /**
   * Override auto-detected environment variables. Useful for testing
   * or when running in environments without standard env var support.
   */
  env?: Partial<SupabaseEnv>

  /**
   * CORS configuration for the `withSupabase` wrapper.
   *
   * - `true` (default) — uses `@supabase/supabase-js` default CORS headers.
   * - `false` — disables CORS handling entirely.
   * - `Record<string, string>` — custom CORS headers.
   *
   * @remarks Only applies to the top-level {@link withSupabase} wrapper.
   * The Hono adapter handles CORS separately via Hono's own middleware.
   *
   * @defaultValue `true`
   */
  cors?: boolean | Record<string, string>

  /**
   * Options forwarded to both internal `createClient()` calls.
   *
   * `accessToken` is stripped, and auth settings (`persistSession`, `autoRefreshToken`,
   * `detectSessionInUrl`) are force-overwritten to server-safe values.
   *
   * @example
   * ```ts
   * withSupabase({
   *   auth: 'user',
   *   supabaseOptions: { db: { schema: 'api' } },
   * }, handler)
   * ```
   */
  supabaseOptions?: SupabaseClientOptions<string>
}

/**
 * Auth identity for client creation functions.
 *
 * @see {@link verifyAuth}, {@link verifyCredentials}
 */
export interface ClientAuth {
  /** The caller's JWT, or `null` for anonymous access. */
  token?: string | null

  /** Name of the API key to use. Falls back to `"default"`, then first available. */
  keyName?: string | null
}

/** Options for {@link createContextClient}. */
export interface CreateContextClientOptions {
  /** Auth identity — token and key name from the verified request. */
  auth?: ClientAuth

  /** Override auto-detected environment variables. */
  env?: Partial<SupabaseEnv>

  /** Options forwarded to `createClient()`. `accessToken` is stripped; auth settings are force-overwritten. */
  supabaseOptions?: SupabaseClientOptions<string>
}

/** Options for {@link createAdminClient}. */
export interface CreateAdminClientOptions {
  /** Auth identity — key name from the verified request. */
  auth?: Pick<ClientAuth, 'keyName'>

  /** Override auto-detected environment variables. */
  env?: Partial<SupabaseEnv>

  /** Options forwarded to `createClient()`. `accessToken` is stripped; auth settings are force-overwritten. */
  supabaseOptions?: SupabaseClientOptions<string>
}

/**
 * The Supabase context created for each authenticated request.
 *
 * Contains pre-configured Supabase clients and the caller's identity.
 * Identical regardless of which layer or adapter produced it.
 */
export interface SupabaseContext<Database = unknown> {
  /** Supabase client scoped to the caller's identity. RLS policies apply. */
  supabase: SupabaseClient<Database>

  /** Admin Supabase client that bypasses Row-Level Security. */
  supabaseAdmin: SupabaseClient<Database>

  /** JWT-derived identity. For the full Supabase User object, call `supabase.auth.getUser()`. */
  userClaims: UserClaims | null

  /** Raw JWT payload. `null` for non-user auth modes. */
  jwtClaims: JWTClaims | null

  /** The auth mode that was used for this request. */
  authMode: AuthMode

  /** The auth key name of the API key that was used for this request. */
  authKeyName?: string | null
}
