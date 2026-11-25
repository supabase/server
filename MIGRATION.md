# Migration

## v1.x → v2.0

v2.0 removes the four framework adapters. They were deprecated in 1.9.0, with
the removal announced for December 1, 2026, and that is the only change in this
major.

### What was removed

| Removed import                     | Replacement                                                |
| ---------------------------------- | ---------------------------------------------------------- |
| `@supabase/server/adapters/hono`   | [`examples/frameworks/hono`](examples/frameworks/hono)     |
| `@supabase/server/adapters/h3`     | [`examples/frameworks/h3`](examples/frameworks/h3)         |
| `@supabase/server/adapters/elysia` | [`examples/frameworks/elysia`](examples/frameworks/elysia) |
| `@supabase/server/adapters/nestjs` | [`examples/frameworks/nestjs`](examples/frameworks/nestjs) |

Each replacement is a bridge: one file you copy into your project that runs a
`@supabase/middleware` entry array in your framework's own middleware slot.
Nothing in this package tracks your framework's major versions.

The NestJS adapter exported a param decorator as well as the guard. It has no
drop-in replacement: the bridge puts the contributions on the request object,
so a controller reads them through `@Req()`.

| Removed                      | Replacement                                                   |
| ---------------------------- | ------------------------------------------------------------- |
| `@SupabaseCtx() ctx`         | `@Req() req: Contributions<typeof entries>`                   |
| `ctx.supabase`               | `req.supabase`                                                |
| `ctx.supabaseAdmin`          | `req.supabaseAdmin`                                           |
| `@SupabaseCtx('userClaims')` | `req.jwtClaims`, rewritten field by field per the table below |

`withSupabase(config, handler)` from the package root is not part of this
change. It is not deprecated, and an endpoint that is already a plain fetch
handler can stay on it.

The optional peer dependencies on `hono`, `h3`, `elysia`, and `@nestjs/common`
are gone too, since no shipped code imports them.

### Read this before you change any code

The adapters rejected unauthenticated requests. `withClaims()` does not.
Migrating an `auth: 'user'` endpoint onto it turns a 401 into a silent 200:
the handler runs with `jwtClaims: null` and an unauthenticated client, and the
endpoint returns whatever Row Level Security lets the anonymous role see.
Nothing throws and nothing logs.

`withRequiredClaims()` is the gate the adapters applied.

| Adapter config               | Rejected before           | Replacement                       |
| ---------------------------- | ------------------------- | --------------------------------- |
| `auth: 'user'`, or no config | missing or invalid JWT    | `withRequiredClaims()`            |
| `auth: 'none'`               | nothing                   | nothing; the client entries alone |
| `auth: 'publishable'`        | missing or wrong `apikey` | none. Keep `withSupabase`         |
| `auth: 'secret'`             | missing or wrong `apikey` | none. Keep `withSupabase`         |

A bare `withSupabase()` with no config was `auth: 'user'` and did reject.
No composable gate exists for `publishable` or `secret`: those endpoints stay
on `withSupabase({ auth: 'publishable' })` or `withSupabase({ auth: 'secret' })`.
Hand-rolling a key check is how endpoints get opened up.

### The shape change

Adapters exposed one nested object. The entries contribute flat keys.

```ts
// Before
const { supabase, userClaims } = c.var.supabaseContext

// After
const supabase = c.var.supabase
const jwtClaims = c.var.jwtClaims
```

For `supabase` and `supabaseAdmin` the rewrite is mechanical. For claims it is
not: no entry contributes `userClaims`, and `jwtClaims` is the raw JWT payload.

| `userClaims` (adapters) | `jwtClaims` (middleware) |
| ----------------------- | ------------------------ |
| `.id`                   | `.sub`                   |
| `.role`                 | `.role`                  |
| `.email`                | `.email`                 |
| `.appMetadata`          | `.app_metadata`          |
| `.userMetadata`         | `.user_metadata`         |

A blanket rename does not reliably fail to compile. `JWTClaims` carries an
index signature, so `jwtClaims.id` is legal and typed `unknown`. It errors
where you assign it to a `string`, but `.eq('id', jwtClaims.id)` on a client
with no `Database` generic compiles clean and writes `undefined` at runtime —
which is the case this warning is about, and the case the compiler does not
catch. Rewrite each read against the table rather than trusting it.

### Full guide

The step-by-step migration, including the per-framework bridges, the error-shape
change, and a prompt you can hand to a coding agent, is at
[supabase.com/docs/reference/server/frameworks](https://supabase.com/docs/reference/server/frameworks#moving-off-the-adapters).

## v0.x → v1.0

v1.0 ships a coordinated set of API renames adopted as part of v1 prep. They make the public surface read more naturally and align with Supabase CLI and env-var terminology. Once v2 lands, the deprecated names below will be removed.

### Renames

| Before                                         | After                                          | Notes                                                                                                                                                                                                                           |
| ---------------------------------------------- | ---------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `withSupabase({ allow: ... })`                 | `withSupabase({ auth: ... })`                  | **Soft-deprecated.** `allow` still works in v1 and emits a one-time `console.warn` per process; `auth` wins when both are present. Removed in v2.                                                                               |
| `auth: 'always'`                               | `auth: 'none'`                                 | Reads more directly as "no authentication required".                                                                                                                                                                            |
| `auth: 'public'` / `'public:<name>'`           | `auth: 'publishable'` / `'publishable:<name>'` | Matches `SUPABASE_PUBLISHABLE_KEY(S)` and the `sb_publishable_...` key prefix.                                                                                                                                                  |
| `ctx.authType` / `auth.authType`               | `ctx.authMode` / `auth.authMode`               | Lines the field up with its `AuthMode` type.                                                                                                                                                                                    |
| `ctx.claims` / `auth.claims`                   | `ctx.jwtClaims` / `auth.jwtClaims`             | Pairs naturally with `userClaims`; distinguishes the snake_case JWT payload from the normalized identity view.                                                                                                                  |
| `SupabaseContext.authKeyName?: string \| null` | `SupabaseContext.authKeyName?: string`         | Single absence representation. The property is omitted for `'user'` / `'none'` modes that don't match a named key. `AuthResult.keyName` deliberately keeps `string \| null` (low-level type where the field is always present). |
| `Allow` / `AllowWithKey` (types)               | `AuthMode` / `AuthModeWithKey`                 | **Soft-deprecated.** Old aliases still resolve to the new types; removed in v2 alongside the `allow` option.                                                                                                                    |

### Migration cheat sheet

Most of the migration is a find-and-replace at the call site:

| Pattern                                                       | Replace with                                                        |
| ------------------------------------------------------------- | ------------------------------------------------------------------- |
| `allow:`                                                      | `auth:` (or leave it for now and silence the warning later)         |
| `auth: 'always'`                                              | `auth: 'none'`                                                      |
| `auth: 'public'` / `'public:<name>'`                          | `auth: 'publishable'` / `'publishable:<name>'`                      |
| `ctx.authType` / `auth.authType`                              | `ctx.authMode` / `auth.authMode`                                    |
| `ctx.claims` / `auth.claims`                                  | `ctx.jwtClaims` / `auth.jwtClaims`                                  |
| `ctx.authKeyName === null`                                    | `ctx.authKeyName === undefined` (or just `!ctx.authKeyName`)        |
| `import type { Allow, AllowWithKey } from '@supabase/server'` | `import type { AuthMode, AuthModeWithKey } from '@supabase/server'` |

### Why these names?

- **`auth` over `allow`** — matches Supabase CLI terminology; `auth: 'user'` reads more naturally as "this endpoint authenticates a user."
- **`'none'` over `'always'`** — `'none'` reads more directly as "no authentication required" than `'always'` did as "always allow."
- **`'publishable'` over `'public'`** — matches the env var names `SUPABASE_PUBLISHABLE_KEY(S)` and the `sb_publishable_...` key prefix used everywhere else in Supabase.
- **`authMode` over `authType`** — lines up the field name with its TypeScript type (`authMode: AuthMode`).
- **`jwtClaims` over `claims`** — reading `userClaims` and `jwtClaims` next to each other makes it obvious which is the normalized identity view vs. the raw JWT payload.
- **`authKeyName?: string` over `string | null`** — single absence representation; consumers don't have to handle both `null` and `undefined`.

### Compatibility timeline

- **v1.x** — deprecated `allow:` option and `Allow` / `AllowWithKey` aliases continue to work; one-time `console.warn` on first use of `allow:`.
- **v2.0** — deprecated names will be removed.

The renamed mode values (`'always'` / `'public'` → `'none'` / `'publishable'`) and the renamed fields (`authType` → `authMode`, `claims` → `jwtClaims`) are **already removed** in v1.0 — their old forms no longer work at runtime or in TypeScript.
