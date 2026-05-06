# Core Primitives

## When to use primitives

Use `withSupabase` or `createSupabaseContext` for standard use cases. Drop down to core primitives when you need:

- Multiple routes with different auth in a single handler
- Custom response headers or error formats
- Integration with frameworks other than the ones provided
- Pre-extracted credentials (e.g., from cookies, custom headers)
- Just auth verification without client creation

All primitives are available from `@supabase/server/core`.

## The composition pipeline

The primitives compose into a pipeline. Each step is independent — use only what you need:

```
resolveEnv()                          → SupabaseEnv
extractCredentials(request)           → Credentials { token, apikey }
verifyCredentials(credentials, opts)  → AuthResult { authType, token, userClaims, claims, keyName }
createContextClient(options)          → SupabaseClient (RLS-scoped)
createAdminClient(options)            → SupabaseClient (bypasses RLS)
```

Or use the convenience function that combines extraction and verification:

```
verifyAuth(request, opts)  → AuthResult (extractCredentials + verifyCredentials in one call)
```

## resolveEnv

Resolves Supabase environment configuration from runtime variables. The only hard requirement is `SUPABASE_URL`.

```ts
import { resolveEnv } from '@supabase/server/core'

const { data: env, error } = resolveEnv()
if (error) {
  // error is an EnvError — e.g., SUPABASE_URL not set
  console.error(error.message)
}
```

With partial overrides:

```ts
const { data: envOverridden } = resolveEnv({
  url: 'http://localhost:54321',
})
```

Returns `{ data: SupabaseEnv, error: null }` on success, `{ data: null, error: EnvError }` on failure.

## extractCredentials

Pure extraction — reads headers, performs no validation.

```ts
import { extractCredentials } from '@supabase/server/core'

const creds = extractCredentials(request)
// creds.token  → string | null  (from Authorization: Bearer <token>)
// creds.apikey → string | null  (from apikey header)
```

This is synchronous and never fails. Fields are `null` when the corresponding header is absent.

## verifyCredentials

Verifies pre-extracted credentials against allowed auth modes. Use this when credentials come from a non-standard source (cookies, custom headers, etc.).

```ts
import { verifyCredentials } from '@supabase/server/core'

const credentials = { token: cookieToken, apikey: null }
const { data: auth, error } = await verifyCredentials(credentials, {
  auth: 'user',
})

if (error) {
  return Response.json({ message: error.message }, { status: error.status })
}

console.log(auth!.authType) // 'user'
console.log(auth!.userClaims) // { id: '...', email: '...', role: 'authenticated' }
```

Supports all auth mode syntax — single mode, arrays, and named keys:

```ts
// Multiple modes
const { data: auth } = await verifyCredentials(creds, {
  auth: ['user', 'publishable'],
})

// Named key
const { data: auth } = await verifyCredentials(creds, {
  auth: 'publishable:web',
})

// Wildcard
const { data: auth } = await verifyCredentials(creds, {
  auth: 'secret:*',
})
```

## verifyAuth

Convenience function that combines `extractCredentials` and `verifyCredentials` in a single call. Use this when working with a standard `Request`:

```ts
import { verifyAuth } from '@supabase/server/core'

const { data: auth, error } = await verifyAuth(request, {
  auth: 'user',
})

if (error) {
  return Response.json({ message: error.message }, { status: error.status })
}

console.log(auth.userClaims!.id) // "d0f1a2b3-..."
console.log(auth.token) // the verified JWT string
```

## createContextClient

Creates a Supabase client scoped to the caller's identity. RLS policies apply.

```ts
import { verifyAuth, createContextClient } from '@supabase/server/core'

// With a user's token (from verifyAuth)
const { data: auth } = await verifyAuth(request, { auth: 'user' })
const supabase = createContextClient({
  auth: { token: auth!.token, keyName: auth!.keyName },
})
```

```ts
// Anonymous (no token) — RLS as anon role
const anonClient = createContextClient()
```

The client is configured with:

- The publishable key as the `apikey` header
- The user's JWT as the `Authorization: Bearer` header (if token is provided)
- Server-safe auth settings: `persistSession: false`, `autoRefreshToken: false`, `detectSessionInUrl: false`

This function throws `EnvError` if `SUPABASE_URL` or the required publishable key is missing. Wrap in try/catch when using directly.

## createAdminClient

Creates a Supabase client that bypasses Row-Level Security using a secret key.

```ts
import { createAdminClient } from '@supabase/server/core'

const supabaseAdmin = createAdminClient()
```

```ts
// With a specific named key
const supabaseAdminInternal = createAdminClient({
  auth: { keyName: 'internal' },
})
```

Same server-safe settings as `createContextClient`. Throws `EnvError` if the secret key is missing.

## Full example: custom multi-route handler

Using primitives to build a handler with different auth per route, without a framework:

```ts
import {
  verifyAuth,
  createContextClient,
  createAdminClient,
} from '@supabase/server/core'

export default {
  fetch: async (req: Request) => {
    const url = new URL(req.url)

    // Public route — no auth needed
    if (url.pathname === '/health') {
      return Response.json({ status: 'ok' })
    }

    // User-authenticated route
    if (url.pathname === '/todos') {
      const { data: auth, error } = await verifyAuth(req, { auth: 'user' })
      if (error) {
        return Response.json(
          { message: error.message },
          { status: error.status },
        )
      }

      const supabase = createContextClient({
        auth: { token: auth!.token, keyName: auth!.keyName },
      })
      const { data } = await supabase.from('todos').select()
      return Response.json(data)
    }

    // Admin route — secret key only
    if (url.pathname === '/admin/users') {
      const { data: auth, error } = await verifyAuth(req, {
        auth: 'secret',
      })
      if (error) {
        return Response.json(
          { message: error.message },
          { status: error.status },
        )
      }

      const supabaseAdmin = createAdminClient({
        auth: { keyName: auth!.keyName },
      })
      const { data } = await supabaseAdmin.from('profiles').select()
      return Response.json(data)
    }

    return new Response('Not found', { status: 404 })
  },
}
```

## SSR frameworks (Next.js, Nuxt, SvelteKit, Remix)

In SSR frameworks, the JWT lives in session cookies rather than the `Authorization` header. Use `verifyCredentials` with a token extracted from cookies, then create clients as usual. This is the key primitive that enables SSR integration — it accepts pre-extracted credentials from any source.

For a complete guide with cookie parsing, JWKS caching, env bridging, and full framework adapters, see [ssr-frameworks.md](ssr-frameworks.md).
