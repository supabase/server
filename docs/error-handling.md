# Error Handling

Every error this library produces identifies itself and tells you what to do about it. An error carries:

| Field     | Description                                                                           |
| --------- | ------------------------------------------------------------------------------------- |
| `source`  | Always `"@supabase/server"` — which library produced this                             |
| `code`    | Machine-readable code, e.g. `MISSING_CREDENTIALS`                                     |
| `message` | Human-readable description, prefixed `[@supabase/server]`                             |
| `hint`    | The actionable next step. Omitted when there isn't a useful one                       |
| `docs`    | Link to the section of this page for `code`                                           |
| `details` | Structured diagnostics — accepted auth modes, what the request carried, key **names** |
| `status`  | HTTP status code (on the error object; not in the JSON body)                          |

`details` never contains secret material: no key values, no token payloads. API keys are reported by _format_ (`"secret"`, `"publishable"`, `"legacy-jwt"`), named keys by _name_ only, and JWTs by their public `alg` / `kid` header fields.

## What a failure looks like

```
HTTP/1.1 401 Unauthorized
x-supabase-server-error: MISSING_CREDENTIALS
Access-Control-Expose-Headers: x-supabase-server-error
```

```json
{
  "source": "@supabase/server",
  "code": "MISSING_CREDENTIALS",
  "message": "[@supabase/server] No credentials found on the request. This endpoint accepts auth mode(s): \"user\", \"publishable\".",
  "hint": "Send one of: Authorization: Bearer <jwt> (for auth mode \"user\"); apikey: <publishable key> (for auth mode \"publishable\").",
  "docs": "https://github.com/supabase/server/blob/main/docs/error-handling.md#missing_credentials",
  "details": {
    "acceptedAuthModes": ["user", "publishable"],
    "received": { "authorization": "absent", "apikey": "absent" }
  }
}
```

The code is repeated in the `x-supabase-server-error` response header, and added to `Access-Control-Expose-Headers` so cross-origin browser code can actually read it.

Every layer that answers a request directly uses this shape: `withSupabase`, and the middleware that short-circuit (`withClaims`, `withRequiredClaims`, `withPostgresClient`).

## Trimming the response body

`hint`, `docs`, and `details` are written for whoever is building against the endpoint. To keep them off the wire, set `errors: { detailed: false }` — the body reduces to `code` and `message`:

```ts
withSupabase({ auth: 'user', errors: { detailed: false } }, handler)
```

```
HTTP/1.1 401 Unauthorized
x-supabase-server-error: MISSING_CREDENTIALS
```

```json
{
  "code": "MISSING_CREDENTIALS",
  "message": "[@supabase/server] No credentials found on the request. This endpoint accepts auth mode(s): \"user\"."
}
```

The status code and the `x-supabase-server-error` header are unaffected, and `message` keeps its `[@supabase/server]` prefix — so the error stays traceable without the `source` field. The **error object itself is untouched**: `createSupabaseContext` callers and the framework adapters still see `hint`, `docs`, and `details` in full.

> This is a verbosity control, not a security boundary. `code` and `message` still describe the failure specifically. To disclose nothing, format the response yourself with `createSupabaseContext` (see [Custom error formatting](#custom-error-formatting)).

## Error classes

```
Error
└── SupabaseServerError    ← catch this for anything from @supabase/server
    ├── EnvError           ← always status 500
    └── AuthError          ← status 401 or 500
```

```ts
import { SupabaseServerError } from '@supabase/server'

try {
  const supabase = createAdminClient()
} catch (e) {
  if (e instanceof SupabaseServerError) {
    console.error(e.code, e.message, e.hint, e.docs)
    return Response.json(e.toJSON(), { status: e.status })
  }
  throw e
}
```

`toJSON()` returns the payload above, and is picked up automatically by `JSON.stringify` — so logging the error yields the full diagnostics instead of `{}`.

## AuthError codes

Thrown when authentication fails. `401` means the request's credentials are at fault. **`500` means the server is misconfigured** — the request could not have succeeded no matter what it sent, so don't blame the caller.

| Code                                                            | Status | Meaning                                                             |
| --------------------------------------------------------------- | ------ | ------------------------------------------------------------------- |
| [`MISSING_CREDENTIALS`](#missing_credentials)                   | 401    | The request carried no credentials at all                           |
| [`UNUSABLE_CREDENTIAL`](#unusable_credential)                   | 401    | A credential arrived, but not one any accepted mode can use         |
| [`INVALID_API_KEY`](#invalid_api_key)                           | 401    | An `apikey` was sent but matched no configured key                  |
| [`INVALID_JWT`](#invalid_jwt)                                   | 401    | A JWT was sent but failed verification                              |
| [`INVALID_CREDENTIALS`](#invalid_credentials)                   | 401    | Fallback when nothing more specific applies                         |
| [`JWKS_NOT_CONFIGURED`](#jwks_not_configured)                   | 500    | A JWT was sent but no JWKS is configured to verify it               |
| [`JWKS_FETCH_FAILED`](#jwks_fetch_failed)                       | 500    | The remote JWKS could not be fetched or parsed                      |
| [`NO_KEYS_CONFIGURED`](#no_keys_configured)                     | 500    | An auth mode was requested that no configured key could ever match  |
| [`UNSUPPORTED_ROLE`](#unsupported_role)                         | 500    | The caller's `role` claim names a role `withPostgresClient` refuses |
| [`CREATE_SUPABASE_CLIENT_ERROR`](#create_supabase_client_error) | 500    | Auth succeeded but client creation failed                           |
| [`AUTH_ERROR`](#auth_error)                                     | 401    | Generic authentication error                                        |

### `MISSING_CREDENTIALS`

The request carried nothing: no `apikey` header, and no `Authorization` header at all.

`details.acceptedAuthModes` lists what the endpoint accepts; `hint` tells you exactly which header to send for each.

If something _did_ arrive but couldn't be used, the code is [`UNUSABLE_CREDENTIAL`](#unusable_credential) instead. The two partition the space exactly, so the code alone tells you which situation you're in — which matters when [`errors: { detailed: false }`](#trimming-the-response-body) strips `hint` and `details`.

### `UNUSABLE_CREDENTIAL`

A credential arrived, but not one any accepted auth mode can use. Three shapes:

- **Wrong kind.** An `sb_*` API key in the `Authorization` header where a user JWT is required. The Supabase SDK sends the key in both the `apikey` and `Authorization` headers, so this is easy to hit by accident. `details.received.authorization` is `"api-key"`.
- **API key to an endpoint that reads none.** Every accepted mode is `user`, so an API key can't satisfy it in _either_ header. This is what an unauthenticated `supabase-js` call to a `user`-only endpoint looks like: the publishable key rides both headers, but no session token does. It's reported here rather than as [`INVALID_API_KEY`](#invalid_api_key) — the key isn't wrong, it's the wrong kind of credential, and "check your project's keys" would send you hunting for a mismatch that doesn't exist.
- **Unreadable.** A header this library can't read a bearer token out of — wrong scheme (`Basic …`), wrong casing (`bearer` — the scheme is case-sensitive), a bare value with no scheme, or `Bearer` with an empty token. `details.received.authorization` is `"non-bearer-scheme"`.

The `message` names which one happened, so the diagnosis survives even with `hint` and `details` stripped. `withRequiredClaims` and `withClaims` report an identical request identically — they only ever accept a user token, so the second shape is the one they hit.

### `INVALID_API_KEY`

An `apikey` header was present but matched none of the keys configured for the attempted modes. Only reported when a `publishable` or `secret` mode was actually attempted — on a `user`-only endpoint an API key is [`UNUSABLE_CREDENTIAL`](#unusable_credential) instead.

The `hint` prioritises format mismatches, since sending the wrong _kind_ of key is the most common cause:

- a secret key sent to a `publishable`-only endpoint (or the reverse)
- a legacy JWT-style `anon` / `service_role` key, where an `sb_publishable_…` / `sb_secret_…` key is expected
- a value that isn't a Supabase API key at all

Otherwise the key was well-formed but simply unknown — usually a different Supabase project. `details.configuredKeyNames` lists the names configured for the attempted modes, and `details.received.apikey` gives the format of what you sent.

### `INVALID_JWT`

A JWT was present in `Authorization` but failed verification. The message names the specific reason and `hint` explains it:

| Reason                                       | Usual cause                                              |
| -------------------------------------------- | -------------------------------------------------------- |
| the token has expired                        | Stale access token, or server clock skew                 |
| the signature did not verify                 | JWKS belongs to a different project                      |
| no key in the JWKS matches the token's `kid` | Wrong project, or a rotated signing key with stale JWKS  |
| its header is missing `alg` or `kid`         | Legacy JWT signed with the shared JWT secret             |
| it has no `sub` claim                        | Not a user token — likely an `anon` / `service_role` JWT |
| a registered claim failed validation         | `nbf` in the future, or a mismatched `aud` / `iss`       |
| the token is malformed                       | Truncated, URL-encoded, or quoted token                  |

`details.jwt` carries the token's `alg` and `kid` — both client-supplied and public — which is what you need to debug a JWKS mismatch. Claim values are never included.

A present-but-invalid JWT rejects immediately rather than falling through to the next auth mode, so this code always wins over a later mode's failure.

### `INVALID_CREDENTIALS`

Fallback code, returned when a credential was present but no more specific code applies.

> **Changed in v1.5.** This used to be the only code returned for a failed request. The specific codes above now cover essentially every real failure, so match on those instead. `INVALID_CREDENTIALS` and `Errors[InvalidCredentialsError]()` remain exported and working.

### `JWKS_NOT_CONFIGURED`

Auth mode `"user"` was requested and a JWT was supplied, but no JWKS is configured — the token cannot be verified.

This is a **`500`**, not a `401`. The endpoint can never authenticate a user in this state.

Set `SUPABASE_JWKS_URL` (e.g. `https://<project-ref>.supabase.co/auth/v1/.well-known/jwks.json`) or `SUPABASE_JWKS` (inline JSON), or pass `env.jwks`.

> A **malformed** value resolves to `null` rather than erroring, and surfaces here. `SUPABASE_JWKS` must be valid JSON; `SUPABASE_JWKS_URL` must be `https` (plain `http` is only accepted for loopback hosts, so the Supabase CLI works against `http://localhost:54321`).

`withClaims` / `withRequiredClaims` report this same code when they reach verification without a JWKS — they only get there with a token in hand, so the situation is identical. Their `hint` names their own `jwks` option instead of `env.jwks`, and `details.middleware` says which one asked.

### `JWKS_FETCH_FAILED`

The remote JWKS endpoint could not be reached, timed out, or returned something unusable — so a token that may well be valid could not be verified.

A **`500`**: an upstream outage is not the caller's fault. The underlying error is attached as `cause`.

### `NO_KEYS_CONFIGURED`

A `publishable` or `secret` auth mode was requested, but no key it could match is configured. Covers both an empty key set and a named mode like `publishable:mobile` when no `"mobile"` key exists.

A **`500`** — that mode can never match any request. `details.mode` names the offending mode and `details.configuredKeyNames` lists what _is_ configured.

This is only reported once every mode has been tried. With `auth: ['publishable:mobile', 'secret']`, a valid secret key still succeeds even though the first mode is unreachable.

### `UNSUPPORTED_ROLE`

`withPostgresClient` will not assume the Postgres role the caller's verified `role` claim names, and refuses rather than silently running the query as `anon` — which would return zero rows and leave nothing to debug.

- `role: "service_role"` — that role bypasses RLS, the guarantee this middleware exists to provide. `hint` points at `withPostgresAdminClient` if bypassing RLS is intended.
- any other custom role — not supported yet; `details.supportedRoles` lists what is.
- a non-string `role` claim — a misconfigured custom-claims hook.

### `CREATE_SUPABASE_CLIENT_ERROR`

Auth succeeded but `createClient()` failed — almost always a missing or malformed `SUPABASE_URL` or API key. The underlying error is attached as `cause`.

When the cause is an `EnvError`, its specific code (e.g. `MISSING_DEFAULT_PUBLISHABLE_KEY`) is preserved instead, along with that error's `hint` and `details`.

### `AUTH_ERROR`

Generic authentication error. The default code when constructing an `AuthError` yourself.

## EnvError codes

Thrown when a required environment variable is missing or malformed. Always `status: 500`.

| Code                                                                  | Meaning                                                            |
| --------------------------------------------------------------------- | ------------------------------------------------------------------ |
| [`MISSING_SUPABASE_URL`](#missing_supabase_url)                       | `SUPABASE_URL` is not set                                          |
| [`MISSING_PUBLISHABLE_KEY`](#missing_publishable_key)                 | Named publishable key not found in `SUPABASE_PUBLISHABLE_KEYS`     |
| [`MISSING_DEFAULT_PUBLISHABLE_KEY`](#missing_default_publishable_key) | No default publishable key found                                   |
| [`MISSING_SECRET_KEY`](#missing_secret_key)                           | Named secret key not found in `SUPABASE_SECRET_KEYS`               |
| [`MISSING_DEFAULT_SECRET_KEY`](#missing_default_secret_key)           | No default secret key found                                        |
| [`MISSING_RESOURCE_SERVER`](#missing_resource_server)                 | `withOAuthProtectedResource` cannot derive a `resourceServer`      |
| [`MISSING_AUTHORIZATION_SERVER`](#missing_authorization_server)       | `withOAuthProtectedResource` cannot derive an authorization server |
| [`MISSING_CONNECTION_STRING`](#missing_connection_string)             | No Postgres connection string is configured                        |
| [`ENV_ERROR`](#env_error)                                             | Generic environment error                                          |

### `MISSING_SUPABASE_URL`

Set `SUPABASE_URL` to your project URL (`https://<project-ref>.supabase.co`), or pass `env.url`. A local Supabase CLI stack uses `http://localhost:54321`.

### `MISSING_PUBLISHABLE_KEY`

The requested named publishable key doesn't exist. The message and `details.configuredKeyNames` list which names _are_ configured.

Add the entry to `SUPABASE_PUBLISHABLE_KEYS` — a JSON object of name → key — or pass `env.publishableKeys`.

### `MISSING_DEFAULT_PUBLISHABLE_KEY`

Set `SUPABASE_PUBLISHABLE_KEY`, or add a `"default"` entry to `SUPABASE_PUBLISHABLE_KEYS`, or pass `env.publishableKeys`.

### `MISSING_SECRET_KEY`

As `MISSING_PUBLISHABLE_KEY`, for `SUPABASE_SECRET_KEYS` / `env.secretKeys`.

### `MISSING_DEFAULT_SECRET_KEY`

Set `SUPABASE_SECRET_KEY`, or add a `"default"` entry to `SUPABASE_SECRET_KEYS`, or pass `env.secretKeys`.

### `MISSING_RESOURCE_SERVER`

`withOAuthProtectedResource` is running outside Supabase Edge Functions, where it can't derive the resource URL from the request. Pass `resourceServer` — `hint` shows the shape.

### `MISSING_AUTHORIZATION_SERVER`

As above for the authorization server. Pass `authorizationServer`, use `fromSupabaseUrl(...)` for Supabase Auth, or set `SUPABASE_PUBLIC_URL` / `SUPABASE_URL`.

### `MISSING_CONNECTION_STRING`

`withPostgresClient` / `withPostgresAdminClient` have no Postgres connection string to connect with, so they short-circuit with a 500 before running the handler.

Set `SUPABASE_DB_URL`, or pass `connectionString` to the middleware — `details.middleware` names which one asked. Supabase Edge Functions provide `SUPABASE_DB_URL` automatically; elsewhere, copy it from Project Settings → Database → Connection string.

### `ENV_ERROR`

Generic environment error. The default code when constructing an `EnvError` yourself.

## How errors surface in each layer

| Function                       | Pattern       | What happens on error                                                   |
| ------------------------------ | ------------- | ----------------------------------------------------------------------- |
| `withSupabase()`               | Auto-response | Returns the JSON payload above, with CORS and `x-supabase-server-error` |
| `withClaims()`                 | Auto-response | Same payload, short-circuiting the pipeline                             |
| `withRequiredClaims()`         | Auto-response | Same payload, short-circuiting the pipeline                             |
| `withPostgresClient()`         | Auto-response | Same payload, on an unsupported `role` claim                            |
| `createSupabaseContext()`      | Result tuple  | Returns `{ data: null, error: AuthError }`                              |
| `verifyAuth()`                 | Result tuple  | Returns `{ data: null, error: AuthError }`                              |
| `verifyCredentials()`          | Result tuple  | Returns `{ data: null, error: AuthError }`                              |
| `resolveEnv()`                 | Result tuple  | Returns `{ data: null, error: EnvError }`                               |
| `createContextClient()`        | **Throws**    | Throws `EnvError`                                                       |
| `createAdminClient()`          | **Throws**    | Throws `EnvError`                                                       |
| `withOAuthProtectedResource()` | **Throws**    | Throws `EnvError` when required off Edge Functions and unconfigured     |
| Hono `withSupabase()`          | HTTPException | Throws `HTTPException` with `cause: AuthError`                          |

`verifyAuth()` also has the raw request in hand, so it adds diagnostics `verifyCredentials()` can't see — most usefully, an `Authorization` header that was present but unusable.

## Custom error formatting

`withSupabase` responds for you. To shape the response yourself, use `createSupabaseContext`:

```ts
import { createSupabaseContext } from '@supabase/server'

export default {
  fetch: async (req: Request) => {
    const { data: ctx, error } = await createSupabaseContext(req, {
      auth: 'user',
    })

    if (error) {
      // Log everything, return only what the caller needs.
      console.error(error.code, error.message, error.hint, error.details)
      return Response.json(
        { success: false, error: { message: error.message, code: error.code } },
        { status: error.status },
      )
    }

    const { data } = await ctx.supabase.from('todos').select()
    return Response.json({ success: true, data })
  },
}
```

## Handling errors in Hono

The Hono adapter throws an `HTTPException` when auth fails. Access the original `AuthError` via `.cause`:

```ts
app.onError((err, c) => {
  if (err instanceof HTTPException && err.cause instanceof AuthError) {
    return c.json(err.cause.toJSON(), err.status)
  }
  return c.json({ message: 'Internal error' }, 500)
})
```

## Handling errors in core primitives

```ts
import { verifyAuth, resolveEnv } from '@supabase/server/core'

const { data: auth, error } = await verifyAuth(request, { auth: 'user' })
if (error) {
  return Response.json(error.toJSON(), { status: error.status })
}

const { data: env, error: envError } = resolveEnv()
if (envError) {
  console.error(`[${envError.code}] ${envError.message}\n${envError.hint}`)
}
```

Client factories throw — wrap them in try/catch:

```ts
import { createContextClient } from '@supabase/server/core'
import { SupabaseServerError } from '@supabase/server'

try {
  const supabase = createContextClient({ auth: { token: auth.token } })
} catch (e) {
  if (e instanceof SupabaseServerError) {
    console.error(e.code, e.message, e.hint)
    return Response.json(e.toJSON(), { status: e.status })
  }
  throw e
}
```

## Using the Errors factory map

`Errors` provides a factory per code, each returning a fully-populated error.

```ts
import {
  Errors,
  MissingSupabaseURLError,
  MissingSecretKeyError,
} from '@supabase/server'

Errors[MissingSupabaseURLError]()
// → EnvError { code: 'MISSING_SUPABASE_URL', status: 500, hint: 'Set SUPABASE_URL to …' }

// Pass the configured names to get them into the message and details.
Errors[MissingSecretKeyError]('mobile', ['default', 'web'])
// → message: '… No "mobile" secret key found. Configured names: "default", "web".'
```

## Checking error types

```ts
import { AuthError, EnvError, SupabaseServerError } from '@supabase/server'

try {
  // ...
} catch (e) {
  if (e instanceof SupabaseServerError) {
    // Anything from @supabase/server. e.code, e.status, e.hint, e.docs, e.details
  }
  if (e instanceof AuthError) {
    // e.status is 401 (bad credentials) or 500 (server misconfigured)
  }
  if (e instanceof EnvError) {
    // e.status is always 500
  }
}
```
