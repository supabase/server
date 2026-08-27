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
- Token present but invalid: short-circuits with a 401 and `{ message, code: 'INVALID_CREDENTIALS' }`.
- Token present but no JWKS configured: short-circuits with a 500 and `{ message, code: 'ENV_ERROR' }`. Verification is required; the middleware has no decode-only mode.

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

- No `Authorization: Bearer` token, or an `sb_*` API key in that position: short-circuits with a 401 and `{ message, code: 'INVALID_CREDENTIALS' }`. The handler never runs.
- Token present but invalid: the same 401.
- Token present but no JWKS configured: short-circuits with a 500 and `{ message, code: 'ENV_ERROR' }`. Verification is required; the middleware has no decode-only mode.

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

Short-circuits with a 500 and `{ message, code: 'ENV_ERROR' }` when no connection string is available.

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

Short-circuits with a 500 and `{ message, code: 'ENV_ERROR' }` when no connection string is available.

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
}
```

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

### EnvError

```ts
class EnvError extends Error {
  readonly status: 500
  readonly code: string
}
```

### AuthError

```ts
class AuthError extends Error {
  readonly status: number // 401 or 500
  readonly code: string
}
```

---

## Error Code Constants

| Constant                            | Value                               | Class       | Meaning                                                        |
| ----------------------------------- | ----------------------------------- | ----------- | -------------------------------------------------------------- |
| `EnvGenericError`                   | `'ENV_ERROR'`                       | `EnvError`  | Generic environment error                                      |
| `MissingSupabaseURLError`           | `'MISSING_SUPABASE_URL'`            | `EnvError`  | `SUPABASE_URL` not set                                         |
| `MissingPublishableKeyError`        | `'MISSING_PUBLISHABLE_KEY'`         | `EnvError`  | Named publishable key not found                                |
| `MissingDefaultPublishableKeyError` | `'MISSING_DEFAULT_PUBLISHABLE_KEY'` | `EnvError`  | No default publishable key                                     |
| `MissingSecretKeyError`             | `'MISSING_SECRET_KEY'`              | `EnvError`  | Named secret key not found                                     |
| `MissingDefaultSecretKeyError`      | `'MISSING_DEFAULT_SECRET_KEY'`      | `EnvError`  | No default secret key                                          |
| `AuthGenericError`                  | `'AUTH_ERROR'`                      | `AuthError` | Generic auth error                                             |
| `InvalidCredentialsError`           | `'INVALID_CREDENTIALS'`             | `AuthError` | No credential matched, or JWT failed verification              |
| `CreateSupabaseClientError`         | `'CREATE_SUPABASE_CLIENT_ERROR'`    | `AuthError` | Client creation failed after auth                              |
| `UnsupportedRoleError`              | `'UNSUPPORTED_ROLE'`                | —           | `withPostgresClient` will not assume the caller's `role` claim |

---

## Errors Factory Map

```ts
const Errors: {
  [MissingSupabaseURLError]: () => EnvError
  [MissingPublishableKeyError]: (name: string) => EnvError
  [MissingDefaultPublishableKeyError]: () => EnvError
  [MissingSecretKeyError]: (name: string) => EnvError
  [MissingDefaultSecretKeyError]: () => EnvError
  [InvalidCredentialsError]: () => AuthError
  [CreateSupabaseClientError]: () => AuthError
}
```

Keyed by error code constant. Each entry returns a pre-configured error instance.
