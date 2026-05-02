# `@supabase/server/gates/rate-limit`

Fixed-window rate-limit gate backed by Supabase Postgres. Counts hits per key within a window via an atomic SQL function; rejects with `429 Too Many Requests` once the limit is exceeded.

```ts
import { createClient } from '@supabase/supabase-js'
import { withRateLimit } from '@supabase/server/gates/rate-limit'

const supabaseAdmin = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_SECRET_KEY!,
)

export default {
  fetch: withRateLimit(
    {
      limit: 60,
      windowMs: 60_000,
      key: (req) => req.headers.get('cf-connecting-ip') ?? 'anon',
      client: supabaseAdmin,
    },
    async (req, ctx) => Response.json({ remaining: ctx.rateLimit.remaining }),
  ),
}
```

## One-time migration

Copy this into `supabase/migrations/<timestamp>_supabase_server_rate_limit.sql` and run `supabase db push`:

```sql
create table if not exists public._supabase_server_rate_limits (
  key       text primary key,
  count     int not null,
  reset_at  bigint not null
);

create or replace function public._supabase_server_rate_limit_hit(
  p_key       text,
  p_window_ms bigint
)
returns json
language plpgsql
as $$
declare
  now_ms bigint := (extract(epoch from clock_timestamp()) * 1000)::bigint;
  result_count int;
  result_reset bigint;
begin
  insert into public._supabase_server_rate_limits (key, count, reset_at)
  values (p_key, 1, now_ms + p_window_ms)
  on conflict (key) do update
    set
      count = case
        when public._supabase_server_rate_limits.reset_at <= now_ms then 1
        else public._supabase_server_rate_limits.count + 1
      end,
      reset_at = case
        when public._supabase_server_rate_limits.reset_at <= now_ms
          then now_ms + p_window_ms
        else public._supabase_server_rate_limits.reset_at
      end
  returning count, reset_at into result_count, result_reset;

  return json_build_object('count', result_count, 'reset_at', result_reset);
end;
$$;

-- Service role only; never exposed via RLS.
alter table public._supabase_server_rate_limits enable row level security;
```

The gate calls `client.rpc('_supabase_server_rate_limit_hit', { p_key, p_window_ms })`. Override the function name via `rpc:` in the config if you'd rather pick your own.

## Config

| Field      | Type                                          | Description                                                 |
| ---------- | --------------------------------------------- | ----------------------------------------------------------- |
| `limit`    | `number`                                      | Maximum hits per `windowMs` per key.                        |
| `windowMs` | `number`                                      | Window length in milliseconds.                              |
| `key`      | `(req: Request) => string \| Promise<string>` | Bucketing key. Per-IP, per-user, per-tenant, etc.           |
| `client`   | `SupabaseRpcClient`                           | Supabase admin client (any structurally compatible object). |
| `rpc`      | `string?`                                     | RPC name. Default: `_supabase_server_rate_limit_hit`.       |

## Contribution

```ts
ctx.rateLimit = {
  limit: number   // configured limit
  remaining: number // hits remaining in current window
  reset: number   // ms epoch when the window resets
}
```

## Errors

- **429 Too Many Requests** with `Retry-After`, `X-RateLimit-Limit`, `X-RateLimit-Remaining: 0`, `X-RateLimit-Reset` headers. Body: `{ error: 'rate_limit_exceeded', retryAfter: <seconds> }`.
- If the RPC isn't installed, the gate throws with a hint pointing at this README's migration block.

## Composing with `withSupabase`

```ts
import type { SupabaseContext } from '@supabase/server'
import { withSupabase } from '@supabase/server'

withSupabase(
  { allow: 'user' },
  withRateLimit<SupabaseContext>(
    {
      limit: 30,
      windowMs: 60_000,
      key: (req) => req.headers.get('cf-connecting-ip') ?? 'anon',
      client: supabaseAdmin,
    },
    async (_req, ctx) => Response.json({ user: ctx.userClaims!.id }),
  ),
)
```

The `<SupabaseContext>` annotation threads the host's keys into the inner handler's `ctx`.

## See also

- [Gate composition primitives](../../core/gates/README.md)
