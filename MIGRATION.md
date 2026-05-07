# Migration

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
