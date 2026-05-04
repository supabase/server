# API Review: @supabase/server

**Source:** https://supabase.github.io/server/
**Date:** May 2, 2026

## Findings

### Warning (5)

#### 1. `cors` config accepts both `false` and `Record<string,string>` — parameter type polymorphism anti-pattern

- **Category:** API Design — Type Polymorphism
- **Endpoint:** `withSupabase({ cors: false | Record<string,string> })`
- **Issue:** The `cors` option accepts either the boolean `false` to disable CORS handling or a `Record<string, string>` of headers to set custom values. Mixing a boolean sentinel with a hash of the same parameter introduces type polymorphism, which causes problems in statically typed languages, degrades IDE autocomplete, and makes serialization / documentation generation fragile. This is listed as a 'use with caution / case by case' pattern in general API design guidance.
- **Recommendation:** Replace the boolean sentinel with a structured enum or an explicit sub-hash. For example: `cors: 'default' | 'disabled' | { headers: Record<string,string> }`. This preserves all existing semantics while making the shape unambiguous. The 'disabled' string is as terse as `false` but participates cleanly in union types and generated docs.

```
// Before (polymorphic)
withSupabase({ cors: false }, handler)
withSupabase({ cors: { 'Access-Control-Allow-Origin': '*' } }, handler)

// After (structured)
withSupabase({ cors: 'disabled' }, handler)
withSupabase({ cors: { headers: { 'Access-Control-Allow-Origin': '*' } } }, handler)
```

#### 2. Named-key auth syntax (`'secret:cron'`) embeds structured data inside a string literal

- **Category:** API Design — Named Key Syntax
- **Endpoint:** `withSupabase({ allow: 'secret:cron' })`
- **Issue:** The `allow: 'secret:cron'` syntax encodes two pieces of configuration — the auth mode and the key name — into a single string separated by a colon. This requires custom string parsing logic, breaks IDE autocomplete for both segments, makes it impossible for type systems to validate either part, and creates an implicit schema that must be documented separately. If either segment ever needs to contain a colon the syntax breaks entirely.
- **Recommendation:** Represent named-key config as a structured object so each part is independently typed and validated. For example: `allow: { mode: 'secret', key: 'cron' }`. The array form already supports multiple auth modes via `allow: ['user', 'secret']`, so a mixed array/object format like `allow: [{ mode: 'secret', key: 'cron' }, 'user']` would remain consistent while being fully typed.

```
// Current — opaque string encoding
withSupabase({ allow: 'secret:cron' }, handler)

// Recommended — structured and type-safe
withSupabase({ allow: { mode: 'secret', key: 'cron' } }, handler)
withSupabase({ allow: [{ mode: 'secret', key: 'cron' }, 'user'] }, handler)
```

#### 3. Error objects returned by primitives expose `status` (HTTP code) rather than a typed `type`/`code` structure

- **Category:** Error Design
- **Endpoint:** `verifyAuth, verifyCredentials, createSupabaseContext, resolveEnv`
- **Issue:** The `verifyAuth` and related primitives return `{ data, error }` where `error` carries `{ message, status }`. Embedding an HTTP status code directly in the error object conflates the transport layer with the application error model. Consumers using the primitives in non-HTTP contexts (e.g., background jobs, test harnesses) must still handle an HTTP-centric field. Additionally, without a machine-readable `type` or `code` field, callers cannot programmatically distinguish between, say, an expired JWT and a missing key without parsing the human-readable `message` string.
- **Recommendation:** Introduce a `type` (e.g., `'unauthorized'`, `'forbidden'`, `'invalid_token'`) and optionally a `code` string on the error object. Retain `status` as a convenience hint, but make it secondary. This mirrors widely adopted error design practice: human-readable `message`, machine-readable `type`/`code`, and HTTP `status` as a rendering hint.

```
// Current
{ error: { message: 'JWT expired', status: 401 } }

// Recommended
{ error: { message: 'JWT expired', type: 'authentication_error', code: 'token_expired', status: 401 } }
```

#### 4. `allow: 'always'` is a counterintuitive name for 'no authentication required'

- **Category:** Naming — Auth Mode
- **Endpoint:** `withSupabase({ allow: 'always' })`
- **Issue:** The auth mode value `'always'` means the handler runs regardless of credentials — i.e., no authentication is required. The name reads as 'always authenticate' or 'always allow everything', which is ambiguous. New integrators routinely have to reach for the docs to confirm that `'always'` is the open/unauthenticated mode rather than a stricter mode. Similarly, `'public'` (validates a publishable key) shares a common understanding of 'no auth required' in web APIs, which conflicts with the mode that actually means 'no auth required' being named `'always'`.
- **Recommendation:** Rename the unauthenticated mode to `'none'` or `'open'`. These names unambiguously convey that no credential validation occurs. If backwards compatibility must be maintained in v0.x, accept both values and mark `'always'` as deprecated.

```
// Current — ambiguous
withSupabase({ allow: 'always' }, handler)

// Recommended — self-explanatory
withSupabase({ allow: 'none' }, handler)
```

#### 5. CORS behavior diverges between the base `withSupabase` and the Hono/H3 adapters under the same function name

- **Category:** Behavioral Consistency — CORS
- **Endpoint:** `@supabase/server vs @supabase/server/adapters/hono and @supabase/server/adapters/h3`
- **Issue:** The root `withSupabase` export automatically injects Supabase CORS headers by default, and its `cors` config option controls that behavior. The Hono and H3 adapter exports are also named `withSupabase` but explicitly do not handle CORS — delegating it to framework utilities. Developers who graduate from the base export to a framework adapter, or who read examples from both contexts, will encounter silent behavioral differences under an identical API name. This is a violation of the principle of least surprise and will produce bugs in production (missing CORS headers) that are hard to trace.
- **Recommendation:** Either make CORS handling consistent across all `withSupabase` variants (adapters can use framework-native mechanisms internally but expose the same `cors` config surface), or rename the adapter exports to make the behavioral difference explicit (e.g., `supabaseMiddleware`) and clearly document the difference in a single place that surfaces during migration.

```
// Root export — CORS handled automatically
import { withSupabase } from '@supabase/server'
withSupabase({ allow: 'user', cors: { 'Access-Control-Allow-Origin': '*' } }, handler)

// Hono adapter — same name, CORS silently absent
import { withSupabase } from '@supabase/server/adapters/hono'
// cors option has no effect — must use hono/cors separately
```

### Suggestion (4)

#### 1. `authKeyName?: string | null` is doubly nullable — choose one absence representation

- **Category:** Data Types — Redundant Nullability
- **Endpoint:** `SupabaseContext.authKeyName`
- **Issue:** The `SupabaseContext.authKeyName` field is typed as `string | null | undefined` (optional property that can also be explicitly null). This dual-absence encoding forces consumers to check for both `=== null` and `=== undefined`, producing inconsistent guard logic. It also makes it unclear whether `null` and `undefined` carry different semantic meaning (they do not appear to).
- **Recommendation:** Pick one absence representation. For a context field that is simply absent when not applicable, `authKeyName?: string` (undefined when absent) is the most idiomatic TypeScript. If the field must always appear on the serialized object, use `authKeyName: string | null` (always present, null when not applicable). Remove the redundant second form.

```
// Current — doubly nullable
interface SupabaseContext {
  authKeyName?: string | null
}

// Recommended — single absence representation
interface SupabaseContext {
  authKeyName?: string  // undefined when no named key was used
}
```

#### 2. `userClaims` vs `claims` distinction is subtle and the naming does not signal the relationship

- **Category:** Naming — Context Fields
- **Endpoint:** `SupabaseContext.userClaims / SupabaseContext.claims`
- **Issue:** The context exposes both `userClaims: UserClaims | null` (described as 'JWT-derived identity (id, email, role)') and `claims: JWTClaims | null` (described as 'full JWT claims'). The relationship — that `userClaims` is a distilled subset of `claims` — is invisible from the names alone. A developer scanning the interface for the first time will not know which to use, and may reach for `claims` when `userClaims` would be safer and more appropriate.
- **Recommendation:** Rename `userClaims` to `user` or `identity` to signal it is the primary, safe representation of the authenticated actor. Rename `claims` to `jwtClaims` or `rawClaims` to signal it is the lower-level, more complete (and potentially unvalidated) payload. Add a brief inline doc comment clarifying the subset relationship.

```
// Current
interface SupabaseContext {
  userClaims: UserClaims | null  // id, email, role
  claims: JWTClaims | null       // full JWT
}

// Recommended
interface SupabaseContext {
  /** Verified user identity extracted from the JWT. Use this for most cases. */
  user: UserIdentity | null
  /** Raw JWT claims. Superset of `user`; use only when accessing non-standard claims. */
  jwtClaims: JWTClaims | null
}
```

#### 3. Plural-takes-priority rule for env vars is a non-obvious footgun with no runtime warning

- **Category:** Environment Variables — Footgun
- **Endpoint:** `SUPABASE_SECRET_KEY / SUPABASE_SECRET_KEYS, SUPABASE_PUBLISHABLE_KEY / SUPABASE_PUBLISHABLE_KEYS`
- **Issue:** The library supports both `SUPABASE_SECRET_KEY` (singular) and `SUPABASE_SECRET_KEYS` (plural JSON map), with plural taking priority if both are set. This silent precedence rule means a developer who sets the singular form for simplicity and later finds the plural form injected by a platform-level secret will silently have their key ignored with no warning or indication of what happened. The plural form also embeds a JSON schema (`{"default":"sb_secret_..."}`) in an environment variable, which is an unusual convention that is easy to mis-serialize.
- **Recommendation:** Emit a runtime warning (or log entry) when both singular and plural forms are detected simultaneously. Consider deprecating the singular forms in a future minor version in favor of the named plural format, since named keys are a first-class feature. Document the priority rule prominently on the environment variables page and at the top of any quick-start guide that shows the singular form.

```
// Dangerous: both set, plural silently wins, singular key is ignored
SUPABASE_SECRET_KEY=sb_secret_abc
SUPABASE_SECRET_KEYS={"default":"sb_secret_xyz"}

// Recommended behavior: warn at startup
[warn] Both SUPABASE_SECRET_KEY and SUPABASE_SECRET_KEYS are set.
       SUPABASE_SECRET_KEYS takes priority. SUPABASE_SECRET_KEY is ignored.
```

#### 4. `allow: 'public'` (publishable-key auth) has no corresponding code example

- **Category:** Discoverability — Auth Mode
- **Endpoint:** `withSupabase({ allow: 'public' })`
- **Issue:** The auth modes table documents four modes — `'user'`, `'public'`, `'secret'`, and `'always'` — but the Quick Start section only provides code examples for `'user'`, `'always'`, `'secret'`, and the array form `['user', 'secret']`. The `'public'` mode (publishable key validation) is described only in a table row. Developers targeting client-facing endpoints that require key validation but not user identity will not find a clear pattern to follow.
- **Recommendation:** Add a Quick Start example for `allow: 'public'` analogous to the existing 'API key protected' example, showing the use case (e.g., a rate-limited public endpoint that validates the caller is a known client app but not a specific user) and confirming that `ctx.supabase` operates as anonymous/RLS in that mode.

```
// Suggested example to add
// A public API that validates the caller is a known client app (publishable key)
// but does not require a signed-in user.
export default {
  fetch: withSupabase({ allow: 'public' }, async (_req, ctx) => {
    // supabase is scoped to anon role — RLS applies
    const { data: games } = await ctx.supabase.from('games').select()
    return Response.json(games)
  }),
}
```

## Positive

#### 1. All primitives follow a consistent `{ data, error }` return envelope

- **Category:** API Consistency
- **Endpoint:** `@supabase/server/core`
- Every function in `@supabase/server/core` — `verifyAuth`, `verifyCredentials`, `createSupabaseContext`, and `resolveEnv` — returns the same `{ data, error }` shape. This mirrors the supabase-js client convention and means developers working across supabase-js and @supabase/server share a single mental model for error handling. There are no mixed-style returns (thrown exceptions vs. error objects vs. status codes) across the primitive surface.

#### 2. Clean three-layer export architecture gives consumers the right abstraction for their needs

- **Category:** API Structure — Layered Exports
- **Endpoint:** `@supabase/server, @supabase/server/core, @supabase/server/adapters/*`
- The package exposes three distinct entry points at carefully graduated levels of abstraction: the main `@supabase/server` (high-level, batteries-included), `@supabase/server/core` (composable primitives for custom flows), and framework-specific adapters under `@supabase/server/adapters/*`. This separation means a developer using Edge Functions never imports framework code, a Hono user gets idiomatic middleware, and a Next.js user building SSR auth can reach for the same verified-auth primitive without taking on unnecessary dependencies. The layering follows the 'decide which user personas you're targeting and polish accordingly' principle well.

#### 3. Explicit `supabase` vs `supabaseAdmin` naming prevents RLS-bypass mistakes at the call site

- **Category:** Security Design
- **Endpoint:** `SupabaseContext.supabase / SupabaseContext.supabaseAdmin`
- Every handler receives both `ctx.supabase` (always RLS-scoped — to the authenticated user or anonymous) and `ctx.supabaseAdmin` (always bypasses RLS). By naming these distinctly and always providing both, the design forces developers to make a deliberate choice at each database call site rather than relying on a mode flag or forgetting to pass a scope. This is a strong safety default: the 'safe' client is the shorter name, making the secure path the path of least resistance.

## API Design Pattern Insights

### Use caution / Parameter type polymorphism

_Source: Best practices & anti-patterns_

Parameter type polymorphism (where a single parameter accepts e.g. a boolean and a hash) can cause problems in bindings in statically typed languages and may not render well in API documentation tools. For cases where a parameter can take either an ID or a struct/hash, the `_data` suffix pattern is recommended to keep them separate. The general advice is to use structured types (hashes/enums) over overloaded primitives.

### Favor Extensibility — Prefer enums to booleans

_Source: Best practices & anti-patterns_

Prefer enums to booleans for properties where there is a good chance the feature set will need to expand. Booleans are not extensible and force a breaking change when a third state is needed. Example: `IssuingCard.status={active, inactive, canceled}` is preferred over `IssuingCard.canceled={true, false}`. This applies directly to the `cors: false` pattern, which should instead be a string enum value like `cors: 'disabled'`.

### Error structure and error codes

_Source: Requests, responses, errors and events_

API errors should carry a `message` (human-readable), a `type` (broad category, e.g. `invalid_request_error`), and a `code` (specific machine-readable code, e.g. `token_expired`) so that callers can programmatically distinguish errors without parsing message strings. An error `code` should only be present when the consumer may want to handle it programmatically. HTTP `status` codes are primarily for machine consumption at the transport layer and should not be the only discriminator in an error object.

### Naming — use simple, unambiguous language

_Source: Data types_

Names must use simple, unambiguous language. Avoid terminology that has a strong pre-existing meaning in a different context. For example, 'public' in web API design almost universally means 'no credentials required', so using it to mean 'requires a publishable key' creates confusion. Similarly, 'always' in a permission context reads as 'always enforce' rather than 'no enforcement'. Clear, literal names reduce the documentation burden.

### Default values should be explicit and representable

_Source: Best practices & anti-patterns_

A default enum value should always be an explicit option in the enum — it should not default to a state that is not representable by any value. Prefer a default value over null on resource fields whenever an implicit default exists, so the behavior of omitting a parameter is explicit to integrators reading the response.

### Thinking about the future — when in doubt, leave it out

_Source: Overview & product philosophy_

Each shipped feature should be justified with a user story. Avoid shipping speculative features. Where future use cases are uncertain, collect more data first. This applies to the plural env var format (SUPABASE_SECRET_KEYS as a JSON map): if named keys are a first-class feature worth the complexity, commit to it; if the singular form is also supported indefinitely, define a clear deprecation path rather than leaving both active with a silent priority rule.
