# Error Handling

## Error classes

The SDK has two error classes, both with `status` (HTTP code) and `code` (machine-readable string) properties.

### EnvError

Thrown when a required environment variable is missing or malformed. Always `status: 500` — these are server configuration issues, not client errors.

| Code                              | Meaning                                                        |
| --------------------------------- | -------------------------------------------------------------- |
| `MISSING_SUPABASE_URL`            | `SUPABASE_URL` is not set                                      |
| `MISSING_PUBLISHABLE_KEY`         | Named publishable key not found in `SUPABASE_PUBLISHABLE_KEYS` |
| `MISSING_DEFAULT_PUBLISHABLE_KEY` | No default publishable key found                               |
| `MISSING_SECRET_KEY`              | Named secret key not found in `SUPABASE_SECRET_KEYS`           |
| `MISSING_DEFAULT_SECRET_KEY`      | No default secret key found                                    |
| `ENV_ERROR`                       | Generic environment error                                      |

### AuthError

Thrown when authentication or authorization fails. Status is `401` for invalid credentials, `500` for server-side auth failures.

| Code                           | Status | Meaning                                                                                   |
| ------------------------------ | ------ | ----------------------------------------------------------------------------------------- |
| `INVALID_CREDENTIALS`          | 401    | No credential matched any allowed auth mode, or a JWT was present but failed verification |
| `CREATE_SUPABASE_CLIENT_ERROR` | 500    | Auth succeeded but client creation failed                                                 |
| `AUTH_ERROR`                   | 401    | Generic authentication error                                                              |

## How errors surface in each layer

Different layers of the SDK handle errors differently. Understanding which pattern each function uses prevents surprises.

| Function                  | Pattern       | What happens on error                                                    |
| ------------------------- | ------------- | ------------------------------------------------------------------------ |
| `withSupabase()`          | Auto-response | Returns `Response.json({ message, code }, { status })` with CORS headers |
| `createSupabaseContext()` | Result tuple  | Returns `{ data: null, error: AuthError }`                               |
| `verifyAuth()`            | Result tuple  | Returns `{ data: null, error: AuthError }`                               |
| `verifyCredentials()`     | Result tuple  | Returns `{ data: null, error: AuthError }`                               |
| `resolveEnv()`            | Result tuple  | Returns `{ data: null, error: EnvError }`                                |
| `createContextClient()`   | **Throws**    | Throws `EnvError`                                                        |
| `createAdminClient()`     | **Throws**    | Throws `EnvError`                                                        |
| Hono `withSupabase()`     | HTTPException | Throws `HTTPException` with `cause: AuthError`                           |

The two client factory functions (`createContextClient`, `createAdminClient`) are the only ones that throw. Everything else returns a result tuple `{ data, error }`.

## Handling errors in withSupabase

`withSupabase` handles errors automatically. If auth fails, the caller receives a JSON response:

```json
{ "message": "Invalid credentials", "code": "INVALID_CREDENTIALS" }
```

with the appropriate HTTP status code and CORS headers. Your handler never runs.

If you need custom error formatting, use `createSupabaseContext` instead:

```ts
import { createSupabaseContext } from '@supabase/server'

export default {
  fetch: async (req: Request) => {
    const { data: ctx, error } = await createSupabaseContext(req, {
      allow: 'user',
    })

    if (error) {
      // Custom error format
      return Response.json(
        {
          success: false,
          error: { message: error.message, code: error.code },
        },
        { status: error.status },
      )
    }

    const { data } = await ctx!.supabase.from('todos').select()
    return Response.json({ success: true, data })
  },
}
```

## Handling errors in Hono

The Hono adapter throws an `HTTPException` when auth fails. Access the original `AuthError` via `.cause`:

```ts
import { Hono } from 'hono'
import { HTTPException } from 'hono/http-exception'
import { withSupabase } from '@supabase/server/adapters/hono'

const app = new Hono()

app.use('*', withSupabase({ allow: 'user' }))

app.onError((err, c) => {
  if (err instanceof HTTPException && err.cause) {
    const authError = err.cause
    return c.json(
      { message: authError.message, code: authError.code },
      err.status,
    )
  }
  return c.json({ message: 'Internal error' }, 500)
})
```

## Handling errors in core primitives

Result-tuple functions:

```ts
import { verifyAuth, resolveEnv } from '@supabase/server/core'

// verifyAuth returns { data, error }
const { data: auth, error } = await verifyAuth(request, { allow: 'user' })
if (error) {
  return Response.json({ message: error.message }, { status: error.status })
}

// resolveEnv returns { data, error }
const { data: env, error: envError } = resolveEnv()
if (envError) {
  console.error(`Config issue [${envError.code}]: ${envError.message}`)
}
```

Client factories throw — wrap them in try/catch:

```ts
import {
  verifyAuth,
  createContextClient,
  createAdminClient,
} from '@supabase/server/core'
import { EnvError } from '@supabase/server'

const { data: auth, error } = await verifyAuth(request, { allow: 'user' })
// ... handle error ...

try {
  const supabase = createContextClient({ auth: { token: auth!.token } })
  const supabaseAdmin = createAdminClient()
} catch (e) {
  if (e instanceof EnvError) {
    console.error(`Config issue [${e.code}]: ${e.message}`)
    return Response.json({ message: e.message }, { status: 500 })
  }
  throw e
}
```

## Using the Errors factory map

The `Errors` object provides factory functions for creating error instances by code. Useful when building custom error handling or testing:

```ts
import {
  Errors,
  MissingSupabaseURLError,
  InvalidCredentialsError,
} from '@supabase/server'

// Create specific errors
const envError = Errors[MissingSupabaseURLError]()
// → EnvError { message: "SUPABASE_URL is required but not set", code: "MISSING_SUPABASE_URL", status: 500 }

const authError = Errors[InvalidCredentialsError]()
// → AuthError { message: "Invalid credentials", code: "INVALID_CREDENTIALS", status: 401 }
```

## Checking error types

```ts
import { AuthError, EnvError } from '@supabase/server'

try {
  // ... some operation
} catch (e) {
  if (e instanceof AuthError) {
    // e.status is 401 or 500
    // e.code is 'INVALID_CREDENTIALS', 'CREATE_SUPABASE_CLIENT_ERROR', or 'AUTH_ERROR'
  }
  if (e instanceof EnvError) {
    // e.status is always 500
    // e.code is one of the MISSING_* constants or 'ENV_ERROR'
  }
}
```
