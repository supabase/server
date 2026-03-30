# Environment Variables

## Variables

| Variable                    | Format                             | Description                                     |
| --------------------------- | ---------------------------------- | ----------------------------------------------- |
| `SUPABASE_URL`              | `https://<ref>.supabase.co`        | Your Supabase project URL                       |
| `SUPABASE_PUBLISHABLE_KEYS` | `{"default":"sb_publishable_..."}` | Named publishable (anon) keys as JSON object    |
| `SUPABASE_SECRET_KEYS`      | `{"default":"sb_secret_..."}`      | Named secret (service-role) keys as JSON object |
| `SUPABASE_JWKS`             | `{"keys":[...]}` or `[...]`        | JSON Web Key Set for JWT verification           |
| `SUPABASE_PUBLISHABLE_KEY`  | `sb_publishable_...`               | Single publishable key (fallback)               |
| `SUPABASE_SECRET_KEY`       | `sb_secret_...`                    | Single secret key (fallback)                    |

## Supabase Edge Functions (zero config)

On Supabase Edge Functions, all environment variables are automatically injected. Your function works with no configuration:

```ts
import { withSupabase } from '@supabase/server'

export default {
  fetch: withSupabase({ allow: 'user' }, async (_req, ctx) => {
    const { data } = await ctx.supabase.from('todos').select()
    return Response.json(data)
  }),
}
```

## Plural vs singular keys

The SDK checks the plural form first (`SUPABASE_PUBLISHABLE_KEYS`), then falls back to the singular form (`SUPABASE_PUBLISHABLE_KEY`).

**Plural form** — a JSON object with named keys:

```
SUPABASE_PUBLISHABLE_KEYS={"default":"sb_publishable_default_abc","web":"sb_publishable_web_xyz"}
```

**Singular form** — a single key value, stored internally as `{ default: "<value>" }`:

```
SUPABASE_PUBLISHABLE_KEY=sb_publishable_default_abc
```

When both are set, the plural form takes priority.

## JWKS format

`SUPABASE_JWKS` accepts two formats:

```
# Standard JWKS format
SUPABASE_JWKS={"keys":[{"kty":"RSA","n":"...","e":"AQAB"}]}

# Bare array (convenience)
SUPABASE_JWKS=[{"kty":"RSA","n":"...","e":"AQAB"}]
```

When `SUPABASE_JWKS` is not set, JWT verification (`allow: 'user'`) is unavailable.

## Runtime-specific behavior

The SDK reads environment variables using this priority:

1. `Deno.env.get(name)` — Deno runtime (Supabase Edge Functions)
2. `process.env[name]` — Node.js, Bun, Cloudflare Workers (with node-compat)

### Deno / Supabase Edge Functions

Environment variables are automatically available. Nothing to configure.

### Node.js / Bun

Set variables via `.env` files (with a loader like `dotenv`) or your hosting platform's environment configuration.

### Cloudflare Workers

Cloudflare Workers don't expose `Deno.env` or `process.env` by default. Two options:

1. **Enable node-compat** in `wrangler.toml`:

   ```toml
   compatibility_flags = ["nodejs_compat"]
   ```

2. **Pass overrides** via the `env` config option:
   ```ts
   withSupabase(
     {
       allow: 'user',
       env: {
         url: env.SUPABASE_URL,
         publishableKeys: { default: env.SUPABASE_PUBLISHABLE_KEY },
         secretKeys: { default: env.SUPABASE_SECRET_KEY },
       },
     },
     handler,
   )
   ```

## Using env overrides

The `env` option on `withSupabase`, `createSupabaseContext`, and core primitives lets you override auto-detected values. Partial overrides are merged with what's resolved from environment variables:

```ts
import { withSupabase } from '@supabase/server'

export default {
  fetch: withSupabase(
    {
      allow: 'user',
      env: {
        url: 'http://localhost:54321', // override just the URL
      },
    },
    handler,
  ),
}
```

## Using resolveEnv directly

For manual environment resolution — useful in tests, custom setups, or debugging:

```ts
import { resolveEnv } from '@supabase/server/core'

const { data: env, error } = resolveEnv()
if (error) {
  console.error(`Missing config: ${error.message}`)
}

// With overrides
const { data: envOverridden } = resolveEnv({
  url: 'http://localhost:54321',
  publishableKeys: { default: 'test-key' },
})
```

`resolveEnv` returns a `SupabaseEnv` object:

```ts
interface SupabaseEnv {
  url: string
  publishableKeys: Record<string, string>
  secretKeys: Record<string, string>
  jwks: JsonWebKeySet | null
}
```

## Graceful parsing

Malformed JSON in environment variables doesn't throw — the SDK falls back to empty values:

- Malformed `SUPABASE_PUBLISHABLE_KEYS` or `SUPABASE_SECRET_KEYS` → empty `{}`
- Malformed `SUPABASE_JWKS` → `null` (JWT verification unavailable)
- Missing `SUPABASE_URL` → `EnvError` (this is the only hard requirement)
