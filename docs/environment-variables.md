## Supabase environments (zero config)

On Supabase Platform and Local Development (CLI), all variables are auto-provisioned — no configuration needed

| Variable                    | Format                             | Description                           | Available in                      |
| --------------------------- | ---------------------------------- | ------------------------------------- | --------------------------------- |
| `SUPABASE_URL`              | `https://<ref>.supabase.co`        | Your Supabase project URL             | All                               |
| `SUPABASE_PUBLISHABLE_KEYS` | `{"default":"sb_publishable_..."}` | Named publishable keys as JSON object | Platform, Local Development (CLI) |
| `SUPABASE_SECRET_KEYS`      | `{"default":"sb_secret_..."}`      | Named secret keys as JSON object      | Platform, Local Development (CLI) |
| `SUPABASE_JWKS`             | `{"keys":[...]}` or `[...]`        | JSON Web Key Set for JWT verification | Platform, Local Development (CLI) |
| `SUPABASE_JWT_AUDIENCE`     | `https://<ref>.supabase.co`        | Expected JWT `aud` claim (optional)   | All                               |
| `SUPABASE_JWT_ISSUER`       | `https://<ref>.supabase.co/auth/v1`| Expected JWT `iss` claim (optional)   | All                               |
| `SUPABASE_PUBLISHABLE_KEY`  | `sb_publishable_...`               | Single publishable key (fallback)     | Self-hosted                       |
| `SUPABASE_SECRET_KEY`       | `sb_secret_...`                    | Single secret key (fallback)          | Self-hosted                       |

## Non-Supabase environments (Node.js, Bun, Cloudflare, self-hosted)

Set these based on which auth modes your app uses:

| Variable                   | Required when                              |
| -------------------------- | ------------------------------------------ |
| `SUPABASE_URL`             | Always                                     |
| `SUPABASE_SECRET_KEY`      | `allow: 'secret'` or using `supabaseAdmin` |
| `SUPABASE_PUBLISHABLE_KEY` | `allow: 'public'`                          |
| `SUPABASE_JWKS`            | `allow: 'user'` (JWT verification)         |
| `SUPABASE_JWT_AUDIENCE`    | Optional — restricts accepted JWT audience |
| `SUPABASE_JWT_ISSUER`      | Optional — restricts accepted JWT issuer   |

### Minimal `.env` example

```env
SUPABASE_URL=https://<ref>.supabase.co
SUPABASE_SECRET_KEY=sb_secret_...
SUPABASE_PUBLISHABLE_KEY=sb_publishable_...
SUPABASE_JWKS={"keys":[...]}
```

## Plural vs singular keys

The SDK checks the plural form first (`SUPABASE_PUBLISHABLE_KEYS`), then falls back to the singular form (`SUPABASE_PUBLISHABLE_KEY`). The same applies to secret keys.

### Plural form — named keys as a JSON object

Use this when you have multiple keys for different clients (web, mobile, internal):

```
SUPABASE_PUBLISHABLE_KEYS={"default":"sb_publishable_default_abc","web":"sb_publishable_web_xyz","mobile":"sb_publishable_mobile_123"}
SUPABASE_SECRET_KEYS={"default":"sb_secret_default_abc","internal":"sb_secret_internal_xyz"}
```

You can then validate against specific keys with named key syntax:

```ts
// Only accept the "web" publishable key
withSupabase({ allow: 'public:web' }, handler)

// Accept any secret key
withSupabase({ allow: 'secret:*' }, handler)
```

### Singular form — equivalent to a single "default" key

```
SUPABASE_PUBLISHABLE_KEY=sb_publishable_default_abc
SUPABASE_SECRET_KEY=sb_secret_default_abc
```

This is equivalent to setting the plural form with a single `"default"` entry:

```
# These two are the same:
SUPABASE_PUBLISHABLE_KEY=sb_publishable_default_abc
SUPABASE_PUBLISHABLE_KEYS={"default":"sb_publishable_default_abc"}
```

The singular form is a convenience for the common case where you only have one key. The SDK stores it internally as `{ default: "<value>" }`, so `allow: 'public'` (which looks for the `"default"` key) works with both forms.

### Priority

When both singular and plural forms are set, the plural form takes priority.

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

1. `Deno.env.get(name)` — Deno (including Supabase Edge Functions)
2. `process.env[name]` — Node.js, Bun, Cloudflare Workers (with node-compat)

### Supabase Edge Functions

Environment variables are auto-provisioned by the platform. Nothing to configure.

### Deno / Node.js / Bun

Set variables via `.env` files (with a loader like `dotenv` for Node.js) or your deployment platform's environment configuration.

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
  audience?: string
  issuer?: string
}
```

## Graceful parsing

Malformed JSON in environment variables doesn't throw — the SDK falls back to empty values:

- Malformed `SUPABASE_PUBLISHABLE_KEYS` or `SUPABASE_SECRET_KEYS` → empty `{}`
- Malformed `SUPABASE_JWKS` → `null` (JWT verification unavailable)
- Missing `SUPABASE_URL` → `EnvError` (this is the only hard requirement)
