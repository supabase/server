# API Reference

Complete reference for every export, organized by entry point.

---

## @supabase/server

### withSupabase

```ts
function withSupabase<Database = unknown>(
  config: WithSupabaseConfig,
  handler: (req: Request, ctx: SupabaseContext<Database>) => Promise<Response>,
): (req: Request) => Promise<Response>
```

Wraps a fetch handler with auth, CORS, and client creation. Returns a `(req: Request) => Promise<Response>` function suitable for `export default { fetch }`.

- Handles `OPTIONS` preflight when CORS is enabled
- Verifies credentials per `config.auth`
- Returns JSON error response on auth failure
- Adds CORS headers to all responses

### createSupabaseContext

```ts
function createSupabaseContext<Database = unknown>(
  request: Request,
  options?: WithSupabaseConfig,
): Promise<
  | { data: SupabaseContext<Database>; error: null }
  | { data: null; error: AuthError }
>
```

Creates a `SupabaseContext` from a request. Returns a result tuple. The `cors` option is ignored.

Defaults to `auth: 'user'` when `options` is omitted.

---

## @supabase/server/core

### verifyAuth

```ts
function verifyAuth(
  request: Request,
  options: {
    auth?: AuthModeWithKey | AuthModeWithKey[]
    env?: Partial<SupabaseEnv>
  },
): Promise<{ data: AuthResult; error: null } | { data: null; error: AuthError }>
```

Extracts credentials from a request and verifies them. Convenience wrapper over `extractCredentials` + `verifyCredentials`.

### verifyCredentials

```ts
function verifyCredentials(
  credentials: Credentials,
  options: {
    auth?: AuthModeWithKey | AuthModeWithKey[]
    env?: Partial<SupabaseEnv>
  },
): Promise<{ data: AuthResult; error: null } | { data: null; error: AuthError }>
```

Verifies pre-extracted credentials against allowed auth modes. Tries each mode in order — first match wins.

### extractCredentials

```ts
function extractCredentials(request: Request): Credentials
```

Reads `Authorization: Bearer <token>` and `apikey` headers from a request. Pure extraction, no validation. Synchronous.

### resolveEnv

```ts
function resolveEnv(
  overrides?: Partial<SupabaseEnv>,
): { data: SupabaseEnv; error: null } | { data: null; error: EnvError }
```

Resolves Supabase environment configuration from runtime variables. `SUPABASE_URL` is the only hard requirement.

### createContextClient

```ts
function createContextClient<Database = unknown>(
  options?: CreateContextClientOptions,
): SupabaseClient<Database>
```

Creates a user-scoped Supabase client. RLS applies. **Throws `EnvError`** if URL or publishable key is missing.

Configured with:

- Publishable key (named or default) as `apikey` header
- User's JWT as `Authorization: Bearer` header (when `auth.token` is provided)
- `persistSession: false`, `autoRefreshToken: false`, `detectSessionInUrl: false`

### createAdminClient

```ts
function createAdminClient<Database = unknown>(
  options?: CreateAdminClientOptions,
): SupabaseClient<Database>
```

Creates an admin Supabase client that bypasses RLS. **Throws `EnvError`** if URL or secret key is missing.

---

## @supabase/server/adapters/hono

### withSupabase (Hono)

```ts
function withSupabase(
  config?: Omit<WithSupabaseConfig, 'cors'>,
): MiddlewareHandler
```

Hono middleware. Sets `c.var.supabaseContext` on the Hono context. Throws `HTTPException` on auth failure with `cause: AuthError`.

Skips if `c.var.supabaseContext` is already set (enables route-level overrides).

Defaults to `auth: 'user'` when config is omitted.

---

## @supabase/server/adapters/h3

### withSupabase (H3)

```ts
function withSupabase(config?: Omit<WithSupabaseConfig, 'cors'>): Middleware
```

H3 middleware. Sets `event.context.supabaseContext` on the H3 event. Throws `HTTPError` on auth failure with `cause: AuthError`.

Skips if `event.context.supabaseContext` is already set (enables chained middleware).

Defaults to `auth: 'user'` when config is omitted.

---

## @supabase/server/adapters/elysia

### withSupabase (Elysia)

```ts
function withSupabase(config?: Omit<WithSupabaseConfig, 'cors'>): Elysia
```

Elysia plugin that resolves `supabaseContext` into the request context. Throws an error on auth failure with `cause: AuthError`.

Skips if `supabaseContext` is already resolved by a prior plugin.

Defaults to `auth: 'user'` when config is omitted.

---

## @supabase/server/middleware/claims

### withClaims

```ts
const withClaims: Middleware<
  'jwtClaims',
  WithClaimsConfig | void,
  Record<never, never>,
  JWTClaims | null
>
```

Contributes `ctx.jwtClaims` by verifying the caller's Bearer token against the project JWKS. This is the same verification core `withSupabase` uses for its `user` auth mode.

Behavior:

- No `Authorization: Bearer` token, or an `sb_*` API key in that position: contributes `null` and the request proceeds as anonymous.
- Token present but invalid: short-circuits with a 401 and code `INVALID_JWT`, naming the specific reason (expired, bad signature, unknown `kid`, malformed, no `sub`).
- Token present but no JWKS configured: short-circuits with a 500 and code `JWKS_NOT_CONFIGURED` — the same code `withSupabase`'s `user` mode reports, with a `hint` naming this middleware's `jwks` option. Verification is required; the middleware has no decode-only mode.
- Remote JWKS unreachable: short-circuits with a 500 and code `JWKS_FETCH_FAILED`.

Responses use the standard [error payload](error-handling.md#what-a-failure-looks-like).

`withClaims` is not an auth gate. It never rejects a request that has no token, so `[withClaims(), withSupabaseClient()]` is not the composable form of `withSupabase({ auth: 'user' })` and accepts anonymous callers. To require an authenticated caller, compose `withRequiredClaims` (`@supabase/server/middleware/required-claims`) instead. The two entries share the `jwtClaims` key, so a pipeline picks "claims if present" or "claims required"; composing both is a compile-time conflict.

### WithClaimsConfig

```ts
interface WithClaimsConfig {
  jwks?: JSONWebKeySet | URL
}
```

Defaults to `SUPABASE_JWKS` (inline JSON) or `SUPABASE_JWKS_URL` (https endpoint) from the environment.

---

## @supabase/server/middleware/required-claims

### withRequiredClaims

```ts
const withRequiredClaims: Middleware<
  'jwtClaims',
  WithRequiredClaimsConfig | void,
  Record<never, never>,
  JWTClaims
>
```

The user-mode auth gate. Verifies the caller's Bearer token against the project JWKS and contributes **non-null** `ctx.jwtClaims`. This is the same verification core `withSupabase` uses for its `user` auth mode.

Behavior:

- No `Authorization` header: short-circuits with a 401 and code `MISSING_CREDENTIALS`. The handler never runs.
- An `sb_*` API key in the `Authorization` header: a 401 with code `UNUSABLE_CREDENTIAL` — a credential arrived, just not a user JWT.
- Token present but invalid: a 401 with code `INVALID_JWT`, naming the specific reason.
- Token present but no JWKS configured: short-circuits with a 500 and code `JWKS_NOT_CONFIGURED` — the same code `withSupabase`'s `user` mode reports, with a `hint` naming this middleware's `jwks` option. Verification is required; the middleware has no decode-only mode.
- Remote JWKS unreachable: short-circuits with a 500 and code `JWKS_FETCH_FAILED`.

Responses use the standard [error payload](error-handling.md#what-a-failure-looks-like).

`withRequiredClaims` is the required-caller counterpart to `withClaims`: "claims required" rather than "claims if present". The two share the `jwtClaims` key, so composing both in one pipeline is a compile-time conflict.

Because the contribution is non-null, gated handlers read `ctx.jwtClaims` directly, and entries declaring a `jwtClaims` prerequisite, such as `withPostgresClient`, compose with no further verification:

```ts
pipeline([withRequiredClaims(), withPostgresClient()], async (req, ctx) => {
  const rows = await ctx.postgres.query`select id, title from posts`
  return Response.json({ rows, caller: ctx.jwtClaims.sub })
})
```

The gate's 401 and 500 short-circuits carry no CORS headers, and a bare pipeline answers no `OPTIONS` preflight. For browser callers, compose `withCors` (`@supabase/middleware/cors`) ahead of the gate: it answers preflight before the gate runs and stamps `Access-Control-*` headers on the gate's short-circuit responses.

Inside `withSupabase` the context already carries verified `jwtClaims`, so composing the gate through the `middleware` option is a compile-time conflict. Use `withSupabase({ auth: 'user' })` to gate that path.

The gate contributes `jwtClaims` and nothing else. A handler that needs the full `SupabaseContext` behind an auth gate (for example `ctx.userClaims` or `ctx.authMode`, which no composable entry contributes) uses `withSupabase({ auth: 'user' })` directly. A host that takes an entries array can wrap it as the sole entry. `cors: 'disabled'` leaves CORS handling to the host:

```ts
const entry = (h: (req: Request, ctx: object) => Promise<Response>) =>
  withSupabase({ auth: 'user', cors: 'disabled' }, h)
```

### WithRequiredClaimsConfig

```ts
interface WithRequiredClaimsConfig {
  jwks?: JSONWebKeySet | URL
}
```

Defaults to `SUPABASE_JWKS` (inline JSON) or `SUPABASE_JWKS_URL` (https endpoint) from the environment.

---

## @supabase/server/middleware/postgres

### withPostgresClient

```ts
const withPostgresClient: Middleware<
  'postgres',
  WithPostgresClientConfig | void,
  { jwtClaims: RequestClaims | null },
  PostgresApi
>
```

Contributes `ctx.postgres` — a `pg` client scoped to the caller by RLS. Each query runs in its own transaction that sets `request.jwt.claims` and drops to the caller's role before the statement, so `auth.uid()` resolves and policies enforce.

Only `authenticated` and `anon` are assumed. A verified token naming any other role — `service_role` or a custom role — short-circuits with a 500 and `{ message, code: 'UNSUPPORTED_ROLE' }` naming the role, rather than being downgraded to `anon`. A missing or absent `role` claim is `anon`.

Requires `ctx.jwtClaims` upstream — supplied by `withSupabase` or by `withClaims` in a standalone `pipeline`. Composing it without one is a compile-time error.

Short-circuits with a 500 and code `MISSING_CONNECTION_STRING` when no connection string is available.

Needs raw TCP: Node, Deno, Bun, and the Supabase Edge runtime, not Workers-style isolates. `pg` is an optional peer dependency.

See [`docs/postgres.md`](postgres.md).

### PostgresApi

```ts
interface PostgresApi {
  query<T = Record<string, unknown>>(
    strings: TemplateStringsArray,
    ...values: unknown[]
  ): Promise<T[]>

  queryRaw<T = Record<string, unknown>>(
    text: string,
    params?: unknown[],
  ): Promise<T[]>
}
```

The value at `ctx.postgres`. Both methods return the result rows directly (not a `pg` `Result`).

`query` is a **tagged template**, so every interpolation becomes a bind parameter and can never alter the statement:

```ts
const rows = await ctx.postgres
  .query`select id, body from notes where id = ${id}`
// -> select id, body from notes where id = $1   with values [id]
```

Tagged templates cannot carry type arguments, so annotate the binding instead of writing `query<NoteRow>`:

```ts
const rows: NoteRow[] = await ctx.postgres.query`select id, body from notes`
```

Passing a plain string to `query` throws — the two calls differ only in their brackets, so it refuses rather than silently reinterpreting.

`queryRaw` takes SQL text plus `params`, for text that cannot be a literal: a query builder emitting `{ sql, parameters }`, or SQL that must interpolate an identifier. Identifiers can never be bind parameters, so check them against a set you control and quote them with `ident`:

```ts
import { ident } from '@supabase/server/middleware/postgres'

const SORTABLE = new Set(['created_at', 'title'])
if (!SORTABLE.has(column)) throw new Error('unsupported sort column')
const rows = await ctx.postgres.queryRaw(
  `select id, title from posts order by ${ident(column)} desc`,
)
```

`ident` quotes and escapes, but does not authorize — it stops injection, not a caller reading a column they should not see. The allowlist is what does that.

### WithPostgresClientConfig

```ts
interface WithPostgresClientConfig {
  connectionString?: string
}
```

Defaults to the `SUPABASE_DB_URL` environment variable. Pools are created lazily, one per connection string per process.

### RequestClaims

```ts
interface RequestClaims {
  role?: string
  [key: string]: unknown
}
```

The minimal claims shape `withPostgresClient` requires upstream at `ctx.jwtClaims`. Satisfied by `withSupabase`'s JWKS-verified claims and by `withClaims`. Only `role` is read; the whole object is serialized into `request.jwt.claims`.

---

## @supabase/server/middleware/postgres-admin

### withPostgresAdminClient

```ts
const withPostgresAdminClient: Middleware<
  'postgresAdmin',
  WithPostgresAdminClientConfig | void,
  Record<never, never>,
  PostgresApi
>
```

Contributes `ctx.postgresAdmin` — a `pg` client that **bypasses RLS**. Queries run as-is, as the role in the connection string: no claim injection, no role switching, no wrapping transaction.

Declares no upstream prerequisite, so it composes in any auth mode including `'secret'` and `'none'`. Shares the pool cache with `withPostgresClient` — same connection string, one pool.

Short-circuits with a 500 and code `MISSING_CONNECTION_STRING` when no connection string is available.

Authorization is the caller's responsibility: RLS is not consulted, so per-user scoping must be an explicit `where` clause.

### WithPostgresAdminClientConfig

```ts
interface WithPostgresAdminClientConfig {
  connectionString?: string
}
```

Defaults to the `SUPABASE_DB_URL` environment variable.

---

## Types

### AuthMode

```ts
type AuthMode = 'none' | 'publishable' | 'secret' | 'user'
```

### AuthModeWithKey

```ts
type AuthModeWithKey = AuthMode | `publishable:${string}` | `secret:${string}`
```

Extended auth mode with named key support. Examples: `'publishable:web'`, `'secret:*'`, `'secret:internal'`. The bare form (`'publishable'` / `'secret'`) matches only the `default` key; `:*` accepts any key in the set.

### Allow / AllowWithKey (deprecated aliases)

`Allow` and `AllowWithKey` are kept as deprecated aliases for `AuthMode` and `AuthModeWithKey`. Prefer the `Auth*` names — the legacy ones will be removed in a future major release.

### SupabaseContext\<Database\>

```ts
interface SupabaseContext<Database = unknown> {
  supabase: SupabaseClient<Database>
  supabaseAdmin: SupabaseClient<Database>
  userClaims: UserClaims | null
  jwtClaims: JWTClaims | null
  authMode: AuthMode
  authKeyName?: string
}
```

### WithSupabaseConfig

```ts
interface WithSupabaseConfig {
  auth?: AuthModeWithKey | AuthModeWithKey[] // default: 'user'
  /** @deprecated use `auth` instead — will be removed in a future major release */
  allow?: AuthModeWithKey | AuthModeWithKey[]
  env?: Partial<SupabaseEnv>
  cors?: boolean | Record<string, string> // default: true
  supabaseOptions?: SupabaseClientOptions<string>
  errors?: ErrorResponseConfig
}
```

### ErrorResponseConfig

```ts
interface ErrorResponseConfig {
  detailed?: boolean // default: true
}
```

`detailed: false` reduces the error response body to `code` and `message` alone, dropping `source`, `hint`, `docs`, and `details`. The status and `x-supabase-server-error` header are unaffected, and the error object itself keeps everything. See [`error-handling.md`](error-handling.md#trimming-the-response-body).

### SupabaseEnv

```ts
interface SupabaseEnv {
  url: string
  publishableKeys: Record<string, string>
  secretKeys: Record<string, string>
  jwks: JsonWebKeySet | null
}
```

### Credentials

```ts
interface Credentials {
  token: string | null
  apikey: string | null
}
```

### AuthResult

```ts
interface AuthResult {
  authMode: AuthMode
  token: string | null
  userClaims: UserClaims | null
  jwtClaims: JWTClaims | null
  keyName?: string | null
}
```

### JWTClaims

```ts
interface JWTClaims {
  sub: string
  iss?: string
  aud?: string | string[]
  exp?: number
  iat?: number
  role?: string
  email?: string
  app_metadata?: Record<string, unknown>
  user_metadata?: Record<string, unknown>
  [key: string]: unknown
}
```

### UserClaims

```ts
interface UserClaims {
  id: string
  role?: string
  email?: string
  appMetadata?: Record<string, unknown>
  userMetadata?: Record<string, unknown>
}
```

### ClientAuth

```ts
interface ClientAuth {
  token?: string | null
  keyName?: string | null
}
```

### CreateContextClientOptions

```ts
interface CreateContextClientOptions {
  auth?: ClientAuth
  env?: Partial<SupabaseEnv>
  supabaseOptions?: SupabaseClientOptions<string>
}
```

### CreateAdminClientOptions

```ts
interface CreateAdminClientOptions {
  auth?: Pick<ClientAuth, 'keyName'>
  env?: Partial<SupabaseEnv>
  supabaseOptions?: SupabaseClientOptions<string>
}
```

### JsonWebKeySet

```ts
interface JsonWebKeySet {
  keys: JsonWebKey[]
}
```

### Peer Dependencies

Some peer dependencies types are available from `@supabase/server/peer/*` export

#### supabase-js

Only a curated set of types are available to import — It means that may be missing types from the original lib.

```ts
import type {
  SupabaseClient,
  PostgrestError,
  AuthError as SupabaseAuthError, // Avoid clashing with this SDK's own `AuthError` class.
  // ...
} from '@supabase/server/peer/supabase-js'
```

---

## Error Classes

### SupabaseServerError

Base class for every error the library produces — catch this to handle anything from `@supabase/server`.

```ts
abstract class SupabaseServerError extends Error {
  readonly source: '@supabase/server'
  abstract readonly status: number
  readonly code: string
  readonly hint?: string // actionable next step
  readonly docs: string // link to docs/error-handling.md#<code>
  readonly details?: Record<string, unknown> // non-sensitive diagnostics
  toJSON(): ErrorPayload
}
```

`message` is always prefixed `[@supabase/server]`. `details` never contains key values or token payloads. `toJSON()` is picked up by `JSON.stringify`, so logging the error yields the full diagnostics.

### EnvError

```ts
class EnvError extends SupabaseServerError {
  readonly status: 500
  constructor(
    message: string,
    code?: string,
    options?: SupabaseServerErrorOptions,
  )
}
```

### AuthError

```ts
class AuthError extends SupabaseServerError {
  readonly status: number // 401 = bad credentials, 500 = server misconfigured
  constructor(
    message: string,
    code?: string,
    status?: number,
    options?: SupabaseServerErrorOptions,
  )
}
```

### ErrorPayload

The JSON body every auto-responding layer returns, and the return type of `toJSON()`.

```ts
interface ErrorPayload {
  source: '@supabase/server'
  code: string
  message: string
  hint?: string
  docs: string
  details?: Record<string, unknown>
}
```

### SupabaseServerErrorOptions

```ts
interface SupabaseServerErrorOptions {
  hint?: string
  details?: Record<string, unknown>
  docs?: string // overrides the generated URL
  cause?: unknown
}
```

---

## Error Code Constants

| Constant                            | Value                               | Class       | Meaning                                                              |
| ----------------------------------- | ----------------------------------- | ----------- | -------------------------------------------------------------------- |
| `EnvGenericError`                   | `'ENV_ERROR'`                       | `EnvError`  | Generic environment error                                            |
| `MissingSupabaseURLError`           | `'MISSING_SUPABASE_URL'`            | `EnvError`  | `SUPABASE_URL` not set                                               |
| `MissingPublishableKeyError`        | `'MISSING_PUBLISHABLE_KEY'`         | `EnvError`  | Named publishable key not found                                      |
| `MissingDefaultPublishableKeyError` | `'MISSING_DEFAULT_PUBLISHABLE_KEY'` | `EnvError`  | No default publishable key                                           |
| `MissingSecretKeyError`             | `'MISSING_SECRET_KEY'`              | `EnvError`  | Named secret key not found                                           |
| `MissingDefaultSecretKeyError`      | `'MISSING_DEFAULT_SECRET_KEY'`      | `EnvError`  | No default secret key                                                |
| `MissingResourceServerError`        | `'MISSING_RESOURCE_SERVER'`         | `EnvError`  | `withOAuthProtectedResource` cannot derive a `resourceServer`        |
| `MissingAuthorizationServerError`   | `'MISSING_AUTHORIZATION_SERVER'`    | `EnvError`  | `withOAuthProtectedResource` cannot derive an authorization server   |
| `MissingConnectionStringError`      | `'MISSING_CONNECTION_STRING'`       | `EnvError`  | No Postgres connection string configured                             |
| `AuthGenericError`                  | `'AUTH_ERROR'`                      | `AuthError` | Generic auth error (401)                                             |
| `MissingCredentialsError`           | `'MISSING_CREDENTIALS'`             | `AuthError` | Request carried no credentials at all (401)                          |
| `UnusableCredentialError`           | `'UNUSABLE_CREDENTIAL'`             | `AuthError` | A credential arrived but cannot be used (401)                        |
| `InvalidApiKeyError`                | `'INVALID_API_KEY'`                 | `AuthError` | `apikey` matched no configured key (401)                             |
| `InvalidJwtError`                   | `'INVALID_JWT'`                     | `AuthError` | JWT failed verification (401)                                        |
| `InvalidCredentialsError`           | `'INVALID_CREDENTIALS'`             | `AuthError` | Fallback credential failure (401)                                    |
| `JwksNotConfiguredError`            | `'JWKS_NOT_CONFIGURED'`             | `AuthError` | JWT sent but no JWKS configured (500)                                |
| `JwksFetchFailedError`              | `'JWKS_FETCH_FAILED'`               | `AuthError` | Remote JWKS unreachable or unusable (500)                            |
| `NoKeysConfiguredError`             | `'NO_KEYS_CONFIGURED'`              | `AuthError` | Auth mode no configured key can match (500)                          |
| `UnsupportedRoleError`              | `'UNSUPPORTED_ROLE'`                | `AuthError` | `withPostgresClient` will not assume the caller's `role` claim (500) |
| `CreateSupabaseClientError`         | `'CREATE_SUPABASE_CLIENT_ERROR'`    | `AuthError` | Client creation failed after auth (500)                              |

Also exported: `ErrorSource` (`'@supabase/server'`) and `ErrorCodeHeader` (`'x-supabase-server-error'`).

See [`error-handling.md`](error-handling.md) for the meaning, `hint`, and `details` of each code.

---

## Errors Factory Map

```ts
const Errors: {
  [MissingSupabaseURLError]: () => EnvError
  [MissingPublishableKeyError]: (name, configuredKeyNames?) => EnvError
  [MissingDefaultPublishableKeyError]: (configuredKeyNames?) => EnvError
  [MissingSecretKeyError]: (name, configuredKeyNames?) => EnvError
  [MissingDefaultSecretKeyError]: (configuredKeyNames?) => EnvError
  [MissingResourceServerError]: () => EnvError
  [MissingAuthorizationServerError]: () => EnvError
  [MissingConnectionStringError]: (middleware: string) => EnvError
  [MissingCredentialsError]: (context: AuthFailureContext) => AuthError
  [UnusableCredentialError]: (
    context: PartialContext & { reason; hint },
  ) => AuthError
  [InvalidApiKeyError]: (context: AuthFailureContext) => AuthError
  [InvalidJwtError]: (context: PartialContext & JwtFailure) => AuthError
  [InvalidCredentialsError]: (context?: AuthFailureContext) => AuthError
  [JwksNotConfiguredError]: (
    context?: PartialContext & { middleware? },
  ) => AuthError
  [JwksFetchFailedError]: (context: PartialContext & { reason }) => AuthError
  [NoKeysConfiguredError]: (
    context: AuthFailureContext & { mode; keyKind },
  ) => AuthError
  [UnsupportedRoleError]: (context: {
    requestedRole
    supportedRoles
  }) => AuthError
  [CreateSupabaseClientError]: (options?: { cause?: unknown }) => AuthError
}
```

Keyed by error code constant. Each entry returns an error pre-configured with `hint`, `docs`, and non-sensitive `details`. The named-key factories accept the configured key names so they can be reported in the message without exposing key values.

### AuthFailureContext

Non-sensitive diagnostics the auth pipeline passes to the factories.

```ts
interface AuthFailureContext {
  authModes: readonly string[]
  received: {
    authorization: 'bearer' | 'api-key' | 'non-bearer-scheme' | 'absent'
    apikey: 'absent' | 'publishable' | 'secret' | 'legacy-jwt' | 'unrecognized'
  }
  configuredKeyNames?: Record<string, readonly string[]>
}
```
