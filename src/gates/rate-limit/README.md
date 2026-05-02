# `@supabase/server/gates/rate-limit`

Fixed-window rate-limit gate. Counts hits per key within a window; rejects with `429 Too Many Requests` once the limit is exceeded.

```ts
import { chain } from '@supabase/server/core/gates'
import { withRateLimit } from '@supabase/server/gates/rate-limit'

export default {
  fetch: chain(
    withRateLimit({
      limit: 60,
      windowMs: 60_000,
      key: (req) => req.headers.get('cf-connecting-ip') ?? 'anon',
    }),
  )(async (req, ctx) => {
    return Response.json({ remaining: ctx.state.rateLimit.remaining })
  }),
}
```

## Config

| Field      | Type                                          | Description                                                       |
| ---------- | --------------------------------------------- | ----------------------------------------------------------------- |
| `limit`    | `number`                                      | Maximum hits per `windowMs` per key.                              |
| `windowMs` | `number`                                      | Window length in milliseconds.                                    |
| `key`      | `(req: Request) => string \| Promise<string>` | Bucketing key. Per-IP, per-user, per-tenant, etc.                 |
| `store`    | `RateLimitStore?`                             | Backing store. Defaults to in-memory `Map` (single-process only). |

## Contribution

```ts
ctx.state.rateLimit = {
  limit: number   // configured limit
  remaining: number // hits remaining in current window
  reset: number   // ms epoch when the window resets
}
```

## Errors

`429 Too Many Requests` with `Retry-After`, `X-RateLimit-Limit`, `X-RateLimit-Remaining: 0`, and `X-RateLimit-Reset` headers. Body: `{ error: 'rate_limit_exceeded', retryAfter: <seconds> }`.

## Production stores

The default in-memory store works for tests and a single long-lived process. Multi-instance / serverless deployments need a shared store so windows aren't reset by request affinity. Implement the `RateLimitStore` interface against Postgres, Redis, or KV:

```ts
import type { RateLimitStore } from '@supabase/server/gates/rate-limit'

const postgresStore: RateLimitStore = {
  async hit(key, windowMs) {
    const { rows } = await db.query(`select * from rate_limit_hit($1, $2)`, [
      key,
      windowMs,
    ])
    return { count: rows[0].count, resetAt: rows[0].reset_at }
  },
}
```

The `hit` method must atomically increment-or-create the bucket. A SQL function is the simplest correct implementation.

## Composing with `withSupabase` for per-user limits

```ts
withSupabase(
  { allow: 'user' },
  chain(
    withRateLimit({
      limit: 30,
      windowMs: 60_000,
      key: async (_req) => {
        // Pull the user id from the upstream Supabase context.
        // Note: the key extractor doesn't see ctx by default; stash it in
        // a closure or use ctx.locals from inside a wrapper gate.
        return 'per-user-key'
      },
    }),
  )(handler),
)
```

For per-user limits, key off `ctx.userClaims.id`. The current `key` signature only sees the request — pass user identity via a header you trust (after `withSupabase` validation), or compose the gate after a small "stamp the user id into req" step.

## See also

- [Gate composition primitives](../../core/gates/README.md)
