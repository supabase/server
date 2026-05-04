# Cookie-based environments (Next.js, SvelteKit, Remix)

## When you need this

In cookie-based frameworks like Next.js, Nuxt, SvelteKit, and Remix, the user's JWT lives in session cookies rather than the `Authorization` header. The high-level wrappers (`withSupabase`, `createSupabaseContext`) expect a standard `Request` with auth headers, so they don't work directly here.

The recommended pattern is to **compose `@supabase/server` with [`@supabase/ssr`](https://github.com/supabase/ssr)**:

- `@supabase/ssr` owns the cookie session lifecycle — reads cookies, writes cookies, and handles refresh-token rotation via middleware.
- `@supabase/server` adds JWT verification (`verifyCredentials`), an RLS-scoped server client (`createContextClient`), and a service-role client (`createAdminClient`) on top.

You hand `@supabase/ssr`'s fresh access token to `verifyCredentials`, then build typed clients from the result.

## How the pieces fit

1. **`@supabase/ssr` middleware** runs on every request and refreshes the access token cookie. Without it, the cookie goes stale, `verifyCredentials` rejects expired tokens, and the user appears logged out — even with a valid refresh token. (Server Components can't write cookies, which is why the refresh has to happen in middleware.)
2. **`@supabase/ssr` `createServerClient`** runs inside your Server Component / Route Handler, reads the (now-fresh) cookie, and exposes `auth.getSession()` / `auth.getUser()`.
3. **`verifyCredentials`** from `@supabase/server/core` cryptographically verifies that access token against JWKS and returns the parsed claims.
4. **`createContextClient`** builds an RLS-scoped `supabase-js` client bound to the verified token.
5. **`createAdminClient`** builds a service-role client (no token needed).

## Step 1 — `@supabase/ssr` middleware (refresh-token rotation)

This middleware is required. It refreshes the access token cookie before any Server Component or Route Handler runs:

```ts
// middleware.ts
import { createServerClient } from '@supabase/ssr'
import { NextResponse, type NextRequest } from 'next/server'

export async function middleware(request: NextRequest) {
  let supabaseResponse = NextResponse.next({ request })

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll()
        },
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value }) =>
            request.cookies.set(name, value),
          )
          supabaseResponse = NextResponse.next({ request })
          cookiesToSet.forEach(({ name, value, options }) =>
            supabaseResponse.cookies.set(name, value, options),
          )
        },
      },
    },
  )

  // Triggers refresh-token rotation and writes the new cookies via setAll.
  await supabase.auth.getUser()

  return supabaseResponse
}

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico).*)'],
}
```

If you skip this middleware, the cookie's access token will eventually expire and `verifyCredentials` will reject the request.

## Step 2 — composed adapter

The adapter reads the (middleware-refreshed) cookie via `@supabase/ssr`, then hands the access token to `@supabase/server`'s primitives. The return shape matches the high-level `createSupabaseContext`, so callers see a familiar `{ supabase, supabaseAdmin, userClaims, claims, authType }` bundle.

```ts
// lib/supabase/context.ts
import { createServerClient } from '@supabase/ssr'
import { cookies } from 'next/headers'
import {
  verifyCredentials,
  createContextClient,
  createAdminClient,
} from '@supabase/server/core'
import type {
  AllowWithKey,
  SupabaseContext,
  SupabaseEnv,
} from '@supabase/server'

function resolveNextEnv(): Partial<SupabaseEnv> {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const publishableKey = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY
  const secretKey = process.env.SUPABASE_SECRET_KEY

  return {
    url: url ?? undefined,
    publishableKeys: publishableKey ? { default: publishableKey } : {},
    secretKeys: secretKey ? { default: secretKey } : {},
  }
}

let cachedJwks: SupabaseEnv['jwks'] = null

async function getJwks(supabaseUrl: string): Promise<SupabaseEnv['jwks']> {
  if (cachedJwks) return cachedJwks
  try {
    const res = await fetch(`${supabaseUrl}/auth/v1/.well-known/jwks.json`)
    if (!res.ok) return null
    cachedJwks = await res.json()
    return cachedJwks
  } catch {
    return null
  }
}

export async function createSupabaseContext(
  options: { allow?: AllowWithKey | AllowWithKey[] } = { allow: 'user' },
): Promise<
  { data: SupabaseContext; error: null } | { data: null; error: Error }
> {
  const nextEnv = resolveNextEnv()

  if (!nextEnv.url || !nextEnv.publishableKeys?.default) {
    return {
      data: null,
      error: new Error('Missing SUPABASE_URL or SUPABASE_PUBLISHABLE_KEY'),
    }
  }

  // Read the @supabase/ssr session cookie. The middleware above has already
  // refreshed the access token, so getSession() returns a fresh JWT.
  const cookieStore = await cookies()
  const ssrClient = createServerClient(
    nextEnv.url,
    nextEnv.publishableKeys.default,
    {
      cookies: {
        getAll() {
          return cookieStore.getAll()
        },
        setAll(cookiesToSet) {
          try {
            cookiesToSet.forEach(({ name, value, options }) =>
              cookieStore.set(name, value, options),
            )
          } catch {
            // Server Components can't write cookies — middleware handles it.
          }
        },
      },
    },
  )

  const {
    data: { session },
  } = await ssrClient.auth.getSession()
  const token = session?.access_token ?? null

  const jwks = await getJwks(nextEnv.url)
  const env: Partial<SupabaseEnv> = { ...nextEnv, jwks }

  const { data: auth, error } = await verifyCredentials(
    { token, apikey: null },
    { allow: options.allow ?? 'user', env },
  )

  if (error) {
    return { data: null, error }
  }

  const supabase = createContextClient({
    auth: { token: auth!.token },
    env,
  })
  const supabaseAdmin = createAdminClient({ env })

  return {
    data: {
      supabase,
      supabaseAdmin,
      userClaims: auth!.userClaims,
      claims: auth!.claims,
      authType: auth!.authType,
    },
    error: null,
  }
}
```

## Does this replace `@supabase/ssr`?

No. `@supabase/ssr` handles cookie-based session management for frameworks like Next.js and SvelteKit. `@supabase/server` handles stateless, header-based auth for Edge Functions, Workers, and other backend runtimes. As you can see in the Next.js example above, the composable primitives already work in SSR environments but require more setup. The two packages coexist and are not replacements for each other. Deeper integration with `@supabase/ssr` is on the roadmap.

## Environment variable bridging

SSR frameworks often use their own naming conventions for environment variables. Map them to a `Partial<SupabaseEnv>` that the core primitives expect:

```ts
import type { SupabaseEnv } from '@supabase/server'

function resolveEnvFromFramework(): Partial<SupabaseEnv> {
  // Example: Next.js uses NEXT_PUBLIC_* for client-exposed vars
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const publishableKey = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY
  const secretKey = process.env.SUPABASE_SECRET_KEY

  return {
    url: url ?? undefined,
    publishableKeys: publishableKey ? { default: publishableKey } : {},
    secretKeys: secretKey ? { default: secretKey } : {},
    // JWKS: either set SUPABASE_JWKS env var, or fetch it (see below)
  }
}
```

## JWKS resolution

JWT verification requires a JWKS (JSON Web Key Set). Two options:

**Option 1: Set the `SUPABASE_JWKS` environment variable.** This is auto-available on the Supabase platform and in local CLI. If set, the core primitives pick it up automatically — no extra code needed.

**Option 2: Fetch from the well-known endpoint and cache.** Useful when deploying to environments where `SUPABASE_JWKS` isn't set:

```ts
import type { SupabaseEnv } from '@supabase/server'

let cachedJwks: SupabaseEnv['jwks'] = null

async function getJwks(supabaseUrl: string): Promise<SupabaseEnv['jwks']> {
  if (cachedJwks) return cachedJwks

  try {
    const res = await fetch(`${supabaseUrl}/auth/v1/.well-known/jwks.json`)
    if (!res.ok) return null
    cachedJwks = await res.json()
    return cachedJwks
  } catch {
    return null
  }
}
```

The cache lives in module scope, so it persists across requests for the lifetime of the server process. For serverless environments (e.g., Vercel), the cache is per-invocation — consider using an external cache or always setting `SUPABASE_JWKS`.

## Usage

### In a Server Component

```tsx
// app/page.tsx
import { createSupabaseContext } from '@/lib/supabase/context'
import { redirect } from 'next/navigation'

export default async function Home() {
  const { data: ctx, error } = await createSupabaseContext()

  if (error) {
    redirect('/auth/login')
  }

  const { data: todos } = await ctx!.supabase.from('todos').select()

  return (
    <ul>
      {todos?.map((t) => (
        <li key={t.id}>{t.title}</li>
      ))}
    </ul>
  )
}
```

### In a Route Handler

```ts
// app/api/todos/route.ts
import { createSupabaseContext } from '@/lib/supabase/context'

export async function GET() {
  const { data: ctx, error } = await createSupabaseContext()

  if (error) {
    return Response.json({ message: error.message }, { status: 401 })
  }

  const { data } = await ctx!.supabase.from('todos').select()
  return Response.json(data)
}
```

### With different auth modes

```ts
// Public endpoint — no auth required
const { data: ctx } = await createSupabaseContext({ auth: 'none' })

// Accept either user JWT or skip auth
const { data: ctx } = await createSupabaseContext({ auth: ['user', 'none'] })
```

## Adapting for other frameworks

The adapter above is Next.js-specific only in how it wires `@supabase/ssr`'s cookie adapter. To adapt for another framework, swap the cookie adapter you pass to `createServerClient` from `@supabase/ssr` — see `@supabase/ssr`'s framework guides for the canonical patterns:

- **SvelteKit:** `event.cookies.getAll()` / `event.cookies.set(name, value, options)` in `+page.server.ts` or `+server.ts`.
- **Remix:** parse cookies from `request.headers.get('cookie')` and emit them via `Set-Cookie` in the response.
- **Nuxt:** use `useCookie` / `getCookie` / `setCookie` from `h3` inside server routes.

Everything else — env bridging, JWKS fetching, `verifyCredentials`, client creation — stays the same.
