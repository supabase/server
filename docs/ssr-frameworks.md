# SSR Frameworks

## When you need this

In SSR frameworks like Next.js, Nuxt, SvelteKit, and Remix, the user's JWT doesn't arrive in an `Authorization` header — it's stored in session cookies managed by `@supabase/ssr`. The high-level wrappers (`withSupabase`, `createSupabaseContext`) expect a standard `Request` with auth headers, so they don't work directly in SSR contexts.

Instead, use the [core primitives](core-primitives.md) to build a lightweight adapter for your framework. The pattern is the same everywhere — only the cookie-reading part changes.

## The pattern

Every SSR adapter follows these steps:

1. **Extract the access token from cookies** (framework-specific)
2. **Bridge environment variables** to the `SupabaseEnv` shape
3. **Resolve JWKS** for JWT verification
4. **Call `verifyCredentials`** with the extracted token
5. **Create clients** with `createContextClient` + `createAdminClient`
6. **Return a `SupabaseContext`**

## Reading Supabase session cookies

`@supabase/ssr` stores the session in cookies using a chunked, base64-encoded format:

- **Cookie name:** `sb-<project-ref>-auth-token` (the project ref is extracted from your Supabase URL)
- **Chunking:** if the session is too large for a single cookie, it's split into `sb-<ref>-auth-token.0`, `.1`, `.2`, etc.
- **Base64 encoding:** the cookie value may be prefixed with `base64-`, indicating base64url encoding

To extract the access token:

```ts
const BASE64_PREFIX = 'base64-'

function getAccessTokenFromCookies(
  getCookie: (name: string) => string | undefined,
  supabaseUrl: string,
): string | null {
  // Extract project ref from URL: "https://abc123.supabase.co" → "abc123"
  const ref = new URL(supabaseUrl).hostname.split('.')[0]
  const storageKey = `sb-${ref}-auth-token`

  // Try single cookie first, then chunked
  let raw = getCookie(storageKey) ?? null

  if (!raw) {
    const chunks: string[] = []
    for (let i = 0; ; i++) {
      const chunk = getCookie(`${storageKey}.${i}`)
      if (!chunk) break
      chunks.push(chunk)
    }
    if (chunks.length > 0) raw = chunks.join('')
  }

  if (!raw) return null

  // Decode base64url if needed
  let decoded = raw
  if (decoded.startsWith(BASE64_PREFIX)) {
    try {
      const base64 = decoded
        .substring(BASE64_PREFIX.length)
        .replace(/-/g, '+')
        .replace(/_/g, '/')
      decoded = atob(base64)
    } catch {
      return null
    }
  }

  // Parse the session JSON and extract access_token
  try {
    const session = JSON.parse(decoded)
    return session.access_token ?? null
  } catch {
    return null
  }
}
```

The `getCookie` parameter is a function that reads a cookie by name — its implementation depends on your framework (e.g., `cookies().get(name)?.value` in Next.js, `event.cookies.get(name)` in SvelteKit).

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

## Complete example: Next.js adapter

A full adapter for Next.js App Router — works in Server Components, Server Actions, and Route Handlers:

```ts
// lib/supabase/context.ts
import { cookies } from 'next/headers'
import {
  verifyCredentials,
  createContextClient,
  createAdminClient,
} from '@supabase/server/core'
import type {
  AuthModeWithKey,
  SupabaseContext,
  SupabaseEnv,
} from '@supabase/server'

const BASE64_PREFIX = 'base64-'

function getAccessTokenFromCookies(
  cookieStore: Awaited<ReturnType<typeof cookies>>,
  url: string,
): string | null {
  const ref = new URL(url).hostname.split('.')[0]
  const storageKey = `sb-${ref}-auth-token`

  let raw = cookieStore.get(storageKey)?.value ?? null

  if (!raw) {
    const chunks: string[] = []
    for (let i = 0; ; i++) {
      const chunk = cookieStore.get(`${storageKey}.${i}`)?.value
      if (!chunk) break
      chunks.push(chunk)
    }
    if (chunks.length > 0) raw = chunks.join('')
  }

  if (!raw) return null

  let decoded = raw
  if (decoded.startsWith(BASE64_PREFIX)) {
    try {
      const base64 = decoded
        .substring(BASE64_PREFIX.length)
        .replace(/-/g, '+')
        .replace(/_/g, '/')
      decoded = atob(base64)
    } catch {
      return null
    }
  }

  try {
    const session = JSON.parse(decoded)
    return session.access_token ?? null
  } catch {
    return null
  }
}

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
  options: { auth?: AuthModeWithKey | AuthModeWithKey[] } = { auth: 'user' },
): Promise<
  { data: SupabaseContext; error: null } | { data: null; error: Error }
> {
  const nextEnv = resolveNextEnv()

  if (!nextEnv.url) {
    return { data: null, error: new Error('Missing SUPABASE_URL') }
  }

  const cookieStore = await cookies()
  const token = getAccessTokenFromCookies(cookieStore, nextEnv.url)

  const jwks = await getJwks(nextEnv.url)
  const env: Partial<SupabaseEnv> = { ...nextEnv, jwks }

  const { data: result, error } = await verifyCredentials(
    { token, apikey: null },
    { auth: options.auth ?? 'user', env },
  )

  if (error) {
    return { data: null, error }
  }

  const supabase = createContextClient({
    auth: { token: result!.token },
    env,
  })
  const supabaseAdmin = createAdminClient({ env })

  return {
    data: {
      supabase,
      supabaseAdmin,
      userClaims: result!.userClaims,
      claims: result!.claims,
      authMode: result!.authMode,
    },
    error: null,
  }
}
```

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

The adapter above is Next.js-specific only in how it reads cookies (`await cookies()` from `next/headers`). To adapt for another framework, replace the cookie-reading logic:

- **SvelteKit:** `event.cookies.get(name)` in `+page.server.ts` or `+server.ts`
- **Nuxt:** `useCookie(name)` in server routes, or `getCookie(event, name)` from `h3`
- **Remix:** `request.headers.get('cookie')` then parse with a cookie library

Everything else — env bridging, JWKS fetching, `verifyCredentials`, client creation — stays the same.
