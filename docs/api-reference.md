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
- Verifies credentials per `config.allow`
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

Defaults to `allow: 'user'` when `options` is omitted.

---

## @supabase/server/core

### verifyAuth

```ts
function verifyAuth(
  request: Request,
  options: { allow: AllowWithKey | AllowWithKey[]; env?: Partial<SupabaseEnv> },
): Promise<{ data: AuthResult; error: null } | { data: null; error: AuthError }>
```

Extracts credentials from a request and verifies them. Convenience wrapper over `extractCredentials` + `verifyCredentials`.

### verifyCredentials

```ts
function verifyCredentials(
  credentials: Credentials,
  options: { allow: AllowWithKey | AllowWithKey[]; env?: Partial<SupabaseEnv> },
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

Defaults to `allow: 'user'` when config is omitted.

---

## Types

### Allow

```ts
type Allow = 'always' | 'public' | 'secret' | 'user'
```

### AllowWithKey

```ts
type AllowWithKey = Allow | `public:${string}` | `secret:${string}`
```

Extended auth mode with named key support. Examples: `'public:web'`, `'secret:*'`, `'secret:internal'`.

### SupabaseContext\<Database\>

```ts
interface SupabaseContext<Database = unknown> {
  supabase: SupabaseClient<Database>
  supabaseAdmin: SupabaseClient<Database>
  userClaims: UserClaims | null
  claims: JWTClaims | null
  authType: Allow
}
```

### WithSupabaseConfig

```ts
interface WithSupabaseConfig {
  allow?: AllowWithKey | AllowWithKey[] // default: 'user'
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
  authType: Allow
  token: string | null
  userClaims: UserClaims | null
  claims: JWTClaims | null
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

| Constant                            | Value                               | Class       | Meaning                           |
| ----------------------------------- | ----------------------------------- | ----------- | --------------------------------- |
| `EnvGenericError`                   | `'ENV_ERROR'`                       | `EnvError`  | Generic environment error         |
| `MissingSupabaseURLError`           | `'MISSING_SUPABASE_URL'`            | `EnvError`  | `SUPABASE_URL` not set            |
| `MissingPublishableKeyError`        | `'MISSING_PUBLISHABLE_KEY'`         | `EnvError`  | Named publishable key not found   |
| `MissingDefaultPublishableKeyError` | `'MISSING_DEFAULT_PUBLISHABLE_KEY'` | `EnvError`  | No default publishable key        |
| `MissingSecretKeyError`             | `'MISSING_SECRET_KEY'`              | `EnvError`  | Named secret key not found        |
| `MissingDefaultSecretKeyError`      | `'MISSING_DEFAULT_SECRET_KEY'`      | `EnvError`  | No default secret key             |
| `AuthGenericError`                  | `'AUTH_ERROR'`                      | `AuthError` | Generic auth error                |
| `InvalidCredentialsError`           | `'INVALID_CREDENTIALS'`             | `AuthError` | No credential matched             |
| `CreateSupabaseClientError`         | `'CREATE_SUPABASE_CLIENT_ERROR'`    | `AuthError` | Client creation failed after auth |

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
