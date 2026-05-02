# `@supabase/server/kv`

A [Deno KV](https://docs.deno.com/deploy/kv/manual/)–shaped key/value store backed by Supabase Postgres. Hierarchical keys, prefix scans, optimistic concurrency via versionstamps, atomic multi-key transactions, and per-entry TTLs.

```ts
import { withSupabase } from '@supabase/server'
import { createKv } from '@supabase/server/kv'

export default {
  fetch: withSupabase({ allow: 'user' }, async (req, ctx) => {
    const kv = createKv(ctx.supabaseAdmin)
    const userId = ctx.userClaims!.id

    await kv.set(['users', userId, 'lastSeen'], Date.now())

    const session = await kv.get<{ token: string }>(['sessions', userId])
    return Response.json({ session })
  }),
}
```

## One-time migration

Copy this into `supabase/migrations/<timestamp>_supabase_server_kv.sql` and run `supabase db push`:

```sql
create table if not exists public._supabase_server_kv (
  key          text        primary key,
  value        jsonb       not null,
  versionstamp bigint      not null,
  expires_at   timestamptz
);

create index if not exists _supabase_server_kv_prefix
  on public._supabase_server_kv (key text_pattern_ops);

create index if not exists _supabase_server_kv_expires
  on public._supabase_server_kv (expires_at)
  where expires_at is not null;

create sequence if not exists public._supabase_server_kv_seq;

-- Versionstamp = lpad-hex of the bigint sequence, 24 chars wide. Compatible
-- with Deno KV's versionstamp shape.
create or replace function public._supabase_server_kv_format_ver(v bigint)
returns text
language sql
immutable
as $$
  select lpad(to_hex(v), 24, '0')
$$;

create or replace function public._supabase_server_kv_get(p_keys text[])
returns json
language sql
as $$
  select coalesce(
    json_agg(
      json_build_object(
        'key',          key,
        'value',        value,
        'versionstamp', public._supabase_server_kv_format_ver(versionstamp)
      )
    ),
    '[]'::json
  )
  from public._supabase_server_kv
  where key = any(p_keys)
    and (expires_at is null or expires_at > now());
$$;

create or replace function public._supabase_server_kv_list(
  p_prefix  text,
  p_start   text,
  p_end     text,
  p_limit   int,
  p_reverse boolean,
  p_cursor  text
)
returns json
language plpgsql
as $$
declare
  rows json;
  next_cursor text;
begin
  with filtered as (
    select key, value, versionstamp
    from public._supabase_server_kv
    where (expires_at is null or expires_at > now())
      and (p_prefix is null or key like (p_prefix || '%'))
      and (p_start  is null or key >= p_start)
      and (p_end    is null or key <  p_end)
      and (
        p_cursor is null
        or (case when p_reverse then key < p_cursor else key > p_cursor end)
      )
    order by key
      using case when p_reverse then operator(pg_catalog.>) else operator(pg_catalog.<) end
    limit p_limit + 1
  )
  select
    coalesce(json_agg(t order by 1), '[]'::json),
    -- cursor = last key of the page when there's more to fetch.
    case
      when count(*) > p_limit then
        (array_agg(key order by 1))[p_limit]
      else null
    end
  into rows, next_cursor
  from (
    select
      key,
      json_build_object(
        'key',          key,
        'value',        value,
        'versionstamp', public._supabase_server_kv_format_ver(versionstamp)
      ) as t
    from filtered
    limit p_limit
  ) page;

  return json_build_object('entries', rows, 'cursor', next_cursor);
end;
$$;

create or replace function public._supabase_server_kv_atomic(
  p_checks      jsonb,   -- { "<encoded_key>": "<versionstamp_or_null>" }
  p_sets        jsonb,   -- { "<encoded_key>": <any json value> }
  p_set_expires jsonb,   -- { "<encoded_key>": <ms epoch> }
  p_deletes     text[],
  p_sums        jsonb    -- { "<encoded_key>": "<bigint as string>" }
)
returns json
language plpgsql
as $$
declare
  v_new_ver  bigint;
  v_check_k  text;
  v_check_v  jsonb;
  v_actual   bigint;
  v_set_k    text;
  v_set_v    jsonb;
  v_sum_k    text;
  v_sum_v    text;
  v_delta    bigint;
  v_current  bigint;
  v_expires  timestamptz;
begin
  -- Run all checks before any write so the operation is all-or-nothing.
  for v_check_k, v_check_v in select * from jsonb_each(coalesce(p_checks, '{}'::jsonb)) loop
    select versionstamp into v_actual
    from public._supabase_server_kv
    where key = v_check_k
      and (expires_at is null or expires_at > now());

    if v_check_v = 'null'::jsonb then
      if v_actual is not null then
        return json_build_object('ok', false);
      end if;
    else
      if v_actual is null
        or public._supabase_server_kv_format_ver(v_actual) <> (v_check_v #>> '{}')
      then
        return json_build_object('ok', false);
      end if;
    end if;
  end loop;

  v_new_ver := nextval('public._supabase_server_kv_seq');

  -- Sets.
  for v_set_k, v_set_v in select * from jsonb_each(coalesce(p_sets, '{}'::jsonb)) loop
    v_expires := null;
    if p_set_expires ? v_set_k then
      v_expires := to_timestamp(((p_set_expires ->> v_set_k)::bigint) / 1000.0);
    end if;
    insert into public._supabase_server_kv (key, value, versionstamp, expires_at)
    values (v_set_k, v_set_v, v_new_ver, v_expires)
    on conflict (key) do update
      set value        = excluded.value,
          versionstamp = excluded.versionstamp,
          expires_at   = excluded.expires_at;
  end loop;

  -- Deletes.
  if p_deletes is not null and array_length(p_deletes, 1) is not null then
    delete from public._supabase_server_kv where key = any(p_deletes);
  end if;

  -- Atomic adds (numeric).
  for v_sum_k, v_sum_v in select key, value #>> '{}' from jsonb_each(coalesce(p_sums, '{}'::jsonb)) loop
    v_delta := v_sum_v::bigint;

    select coalesce((value #>> '{}')::bigint, 0) into v_current
    from public._supabase_server_kv
    where key = v_sum_k
      and (expires_at is null or expires_at > now());

    insert into public._supabase_server_kv (key, value, versionstamp)
    values (v_sum_k, to_jsonb((coalesce(v_current, 0) + v_delta)::text), v_new_ver)
    on conflict (key) do update
      set value        = excluded.value,
          versionstamp = excluded.versionstamp;
  end loop;

  return json_build_object(
    'ok',           true,
    'versionstamp', public._supabase_server_kv_format_ver(v_new_ver)
  );
end;
$$;

-- Service role only; never exposed via RLS.
alter table public._supabase_server_kv enable row level security;
```

The store uses `public._supabase_server_kv_seq` as a monotonic version source — every successful atomic commit calls `nextval`, so versionstamps strictly increase across the entire database.

## API

### `createKv(client, options?)`

Returns a `Kv` bound to a Supabase admin client.

| Option        | Type      | Description                                                         |
| ------------- | --------- | ------------------------------------------------------------------- |
| `rpcs.get`    | `string?` | Override the get RPC name. Default `_supabase_server_kv_get`.       |
| `rpcs.list`   | `string?` | Override the list RPC name. Default `_supabase_server_kv_list`.     |
| `rpcs.atomic` | `string?` | Override the atomic RPC name. Default `_supabase_server_kv_atomic`. |

### `kv.get<T>(key)`

```ts
const entry = await kv.get<{ name: string }>(['users', 'alice'])
// { key, value, versionstamp } or { key, value: null, versionstamp: null }
```

### `kv.getMany<T[]>(keys)`

Batch-fetch multiple entries in one round-trip. Output order matches input order; missing entries get `value: null, versionstamp: null`.

### `kv.set(key, value, options?)`

```ts
await kv.set(['users', 'alice'], { name: 'Alice' })
await kv.set(['session', sessionId], data, { expireIn: 60_000 }) // 60s TTL
```

Returns `{ ok: true, versionstamp }`.

### `kv.delete(key)`

No-op if the key does not exist.

### `kv.list(selector, options?)`

Returns an async iterator of entries.

```ts
for await (const entry of kv.list({ prefix: ['users'] })) {
  // entry: { key, value, versionstamp }
}

// Range:
for await (const entry of kv.list({ start: ['a'], end: ['m'] })) { … }

// Reverse + limit:
for await (const entry of kv.list({ prefix: ['logs'] }, { reverse: true, limit: 50 })) { … }
```

### `kv.atomic()`

Builds a single atomic transaction. Mirrors `Deno.Kv.atomic()`.

```ts
const result = await kv
  .atomic()
  .check({ key: ['counter'], versionstamp: previousVer })
  .set(['counter'], next)
  .commit()

if (!result.ok) {
  // someone else wrote first; reload and retry
}
```

Operations:

- `.check({ key, versionstamp })` — require an entry to be at the given versionstamp at commit time. `versionstamp: null` requires the entry to not exist (useful for create-if-absent).
- `.set(key, value, { expireIn? })` — write a value.
- `.delete(key)` — remove an entry.
- `.sum(key, n)` — atomically add `n` (a `bigint` or `number`) to a numeric counter. Missing keys are treated as `0`.

Commit returns `{ ok: true, versionstamp }` if every check passed, `{ ok: false }` otherwise.

## Keys

Keys are arrays of `string | number | bigint | boolean | Uint8Array`, just like Deno KV.

Encoded keys use type-tagged, percent-escaped, slash-separated parts (e.g. `s.users/s.alice/`), so `[a]` is a strict prefix of `[a, b]` but not of `[ab]` — the property prefix scans rely on. See `keys.ts` for the full encoding.

A note on ordering: lexical ordering is correct and stable for **string** keys. Numeric and bigint parts are encoded as decimal text, so `1, 2, 10` sorts as `1, 10, 2`. If you need numeric range scans, zero-pad numbers as strings (`'00010'`) before storing.

## Limitations

- **No watch**. Real-time updates aren't supported. Use Supabase Realtime on the underlying table if you need them.
- **No queues** (`enqueue` / `listenQueue`). Use [pgmq](https://supabase.com/docs/guides/queues) directly.
- **One round-trip per RPC**. The TS API doesn't pipeline — every `get`/`set`/atomic commit is one HTTP call.
- **Numeric ordering** is lexical (see Keys section).
- **Expired entries are not auto-deleted** — they're filtered out on read. A periodic `delete from _supabase_server_kv where expires_at <= now()` cron is recommended for cleanup.

## See also

- [Deno KV manual](https://docs.deno.com/deploy/kv/manual/) — the API this module mirrors.
