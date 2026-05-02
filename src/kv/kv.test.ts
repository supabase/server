import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'

import { createKv, type SupabaseRpcClient } from './kv.js'

interface Row {
  value: unknown
  versionstamp: bigint
  expiresAt: number | null
}

/**
 * In-memory fake of the three SQL functions the gate calls. Mirrors their
 * contracts closely enough to catch wire-protocol bugs.
 */
function makeFakeAdmin(): SupabaseRpcClient & {
  rpc: ReturnType<typeof vi.fn>
} {
  const store = new Map<string, Row>()
  let seq = 0n

  const isLive = (row: Row) =>
    row.expiresAt === null || row.expiresAt > Date.now()

  const formatVer = (v: bigint) => v.toString(16).padStart(24, '0')

  const get = (args: { p_keys: string[] }) => {
    const out: { key: string; value: unknown; versionstamp: string }[] = []
    for (const k of args.p_keys) {
      const row = store.get(k)
      if (!row || !isLive(row)) continue
      out.push({
        key: k,
        value: row.value,
        versionstamp: formatVer(row.versionstamp),
      })
    }
    return out
  }

  const list = (args: {
    p_prefix: string | null
    p_start: string | null
    p_end: string | null
    p_limit: number
    p_reverse: boolean
    p_cursor: string | null
  }) => {
    let entries = [...store.entries()]
      .filter(([, row]) => isLive(row))
      .filter(([k]) => {
        if (args.p_prefix && !k.startsWith(args.p_prefix)) return false
        if (args.p_start && k < args.p_start) return false
        if (args.p_end && k >= args.p_end) return false
        return true
      })
      .sort(([a], [b]) =>
        args.p_reverse ? b.localeCompare(a) : a.localeCompare(b),
      )
    if (args.p_cursor) {
      const cursor = args.p_cursor
      entries = entries.filter(([k]) =>
        args.p_reverse ? k < cursor : k > cursor,
      )
    }
    const page = entries.slice(0, args.p_limit)
    const cursor =
      entries.length > args.p_limit ? page[page.length - 1][0] : null
    return {
      entries: page.map(([k, row]) => ({
        key: k,
        value: row.value,
        versionstamp: formatVer(row.versionstamp),
      })),
      cursor,
    }
  }

  const atomic = (args: {
    p_checks: Record<string, string | null>
    p_sets: Record<string, unknown>
    p_set_expires: Record<string, number>
    p_deletes: string[]
    p_sums: Record<string, string>
  }) => {
    for (const [k, expected] of Object.entries(args.p_checks)) {
      const row = store.get(k)
      const actual = row && isLive(row) ? formatVer(row.versionstamp) : null
      if (expected !== actual) return { ok: false }
    }

    seq += 1n
    const ver = seq

    for (const [k, value] of Object.entries(args.p_sets)) {
      const expiresAt = args.p_set_expires[k] ?? null
      store.set(k, { value, versionstamp: ver, expiresAt })
    }
    for (const k of args.p_deletes) store.delete(k)
    for (const [k, deltaStr] of Object.entries(args.p_sums)) {
      const delta = BigInt(deltaStr)
      const existing = store.get(k)
      const current =
        existing && isLive(existing) ? BigInt(existing.value as string) : 0n
      store.set(k, {
        value: (current + delta).toString(),
        versionstamp: ver,
        expiresAt: existing?.expiresAt ?? null,
      })
    }

    return { ok: true, versionstamp: formatVer(ver) }
  }

  const rpc = vi.fn(
    async (
      fn: string,
      args: Record<string, unknown>,
    ): Promise<{ data: unknown; error: null }> => {
      switch (fn) {
        case '_supabase_server_kv_get':
          return { data: get(args as Parameters<typeof get>[0]), error: null }
        case '_supabase_server_kv_list':
          return { data: list(args as Parameters<typeof list>[0]), error: null }
        case '_supabase_server_kv_atomic':
          return {
            data: atomic(args as Parameters<typeof atomic>[0]),
            error: null,
          }
        default:
          throw new Error(`unexpected rpc: ${fn}`)
      }
    },
  )
  return { rpc } as SupabaseRpcClient & { rpc: typeof rpc }
}

beforeAll(() => {
  vi.useFakeTimers()
  vi.setSystemTime(new Date(1_700_000_000_000))
})

afterEach(() => {
  vi.setSystemTime(new Date(1_700_000_000_000))
})

describe('createKv: get / set / delete', () => {
  it('returns null entries for unknown keys', async () => {
    const kv = createKv(makeFakeAdmin())
    const entry = await kv.get(['missing'])
    expect(entry).toEqual({
      key: ['missing'],
      value: null,
      versionstamp: null,
    })
  })

  it('roundtrips arbitrary JSON values', async () => {
    const kv = createKv(makeFakeAdmin())
    const value = { name: 'Alice', tags: ['admin', 'beta'] }
    const set = await kv.set(['users', 'alice'], value)
    expect(set.ok).toBe(true)
    expect(set.versionstamp).toMatch(/^[0-9a-f]{24}$/)

    const got = await kv.get<typeof value>(['users', 'alice'])
    expect(got.value).toEqual(value)
    expect(got.versionstamp).toBe(set.versionstamp)
    expect(got.key).toEqual(['users', 'alice'])
  })

  it('overwrites in place and bumps the versionstamp', async () => {
    const kv = createKv(makeFakeAdmin())
    const a = await kv.set(['k'], 1)
    const b = await kv.set(['k'], 2)
    expect(BigInt('0x' + b.versionstamp)).toBeGreaterThan(
      BigInt('0x' + a.versionstamp),
    )
    expect((await kv.get(['k'])).value).toBe(2)
  })

  it('delete removes the entry', async () => {
    const kv = createKv(makeFakeAdmin())
    await kv.set(['k'], 'v')
    await kv.delete(['k'])
    expect((await kv.get(['k'])).value).toBeNull()
  })

  it('honors expireIn (entry disappears after TTL)', async () => {
    const kv = createKv(makeFakeAdmin())
    await kv.set(['session'], 'data', { expireIn: 60_000 })
    expect((await kv.get(['session'])).value).toBe('data')
    vi.setSystemTime(new Date(1_700_000_060_001))
    expect((await kv.get(['session'])).value).toBeNull()
  })

  it('getMany preserves input order and includes missing entries', async () => {
    const kv = createKv(makeFakeAdmin())
    await kv.set(['a'], 1)
    await kv.set(['c'], 3)
    const [a, b, c] = await kv.getMany<[number, number, number]>([
      ['a'],
      ['b'],
      ['c'],
    ])
    expect(a.value).toBe(1)
    expect(b.value).toBeNull()
    expect(c.value).toBe(3)
  })
})

describe('createKv: list', () => {
  it('iterates entries matching a prefix in lexicographic order', async () => {
    const kv = createKv(makeFakeAdmin())
    await kv.set(['users', 'alice'], 1)
    await kv.set(['users', 'bob'], 2)
    await kv.set(['users', 'carol'], 3)
    await kv.set(['other'], 999)

    const collected: { key: unknown; value: unknown }[] = []
    for await (const entry of kv.list({ prefix: ['users'] })) {
      collected.push({ key: entry.key, value: entry.value })
    }
    expect(collected).toEqual([
      { key: ['users', 'alice'], value: 1 },
      { key: ['users', 'bob'], value: 2 },
      { key: ['users', 'carol'], value: 3 },
    ])
  })

  it('honors `reverse: true`', async () => {
    const kv = createKv(makeFakeAdmin())
    await kv.set(['n', '1'], 1)
    await kv.set(['n', '2'], 2)
    await kv.set(['n', '3'], 3)
    const values: unknown[] = []
    for await (const e of kv.list({ prefix: ['n'] }, { reverse: true })) {
      values.push(e.value)
    }
    expect(values).toEqual([3, 2, 1])
  })

  it('honors `limit`', async () => {
    const kv = createKv(makeFakeAdmin())
    for (let i = 0; i < 5; i++) await kv.set(['n', String(i)], i)
    const values: unknown[] = []
    for await (const e of kv.list({ prefix: ['n'] }, { limit: 2 })) {
      values.push(e.value)
    }
    expect(values).toHaveLength(2)
  })

  it('returns nothing for an empty prefix range', async () => {
    const kv = createKv(makeFakeAdmin())
    await kv.set(['users', 'alice'], 1)
    const seen: unknown[] = []
    for await (const e of kv.list({ prefix: ['empty'] })) seen.push(e)
    expect(seen).toEqual([])
  })
})

describe('createKv: atomic', () => {
  it('commits set + delete in one transaction', async () => {
    const kv = createKv(makeFakeAdmin())
    await kv.set(['old'], 1)

    const result = await kv.atomic().set(['new'], 2).delete(['old']).commit()

    expect(result.ok).toBe(true)
    expect((await kv.get(['old'])).value).toBeNull()
    expect((await kv.get(['new'])).value).toBe(2)
  })

  it('check passes when versionstamp matches', async () => {
    const kv = createKv(makeFakeAdmin())
    const created = await kv.set(['k'], 1)

    const result = await kv
      .atomic()
      .check({ key: ['k'], versionstamp: created.versionstamp })
      .set(['k'], 2)
      .commit()

    expect(result.ok).toBe(true)
    expect((await kv.get(['k'])).value).toBe(2)
  })

  it('check fails when versionstamp does not match', async () => {
    const kv = createKv(makeFakeAdmin())
    await kv.set(['k'], 1)

    const result = await kv
      .atomic()
      .check({ key: ['k'], versionstamp: 'deadbeef'.padStart(24, '0') })
      .set(['k'], 2)
      .commit()

    expect(result.ok).toBe(false)
    expect((await kv.get(['k'])).value).toBe(1) // unchanged
  })

  it('check with versionstamp: null requires the key to be absent', async () => {
    const kv = createKv(makeFakeAdmin())

    const create = await kv
      .atomic()
      .check({ key: ['k'], versionstamp: null })
      .set(['k'], 'first')
      .commit()
    expect(create.ok).toBe(true)

    const reCreate = await kv
      .atomic()
      .check({ key: ['k'], versionstamp: null })
      .set(['k'], 'second')
      .commit()
    expect(reCreate.ok).toBe(false)
    expect((await kv.get(['k'])).value).toBe('first')
  })

  it('sum atomically increments a counter', async () => {
    const kv = createKv(makeFakeAdmin())
    await kv.atomic().sum(['counter'], 5).commit()
    await kv.atomic().sum(['counter'], 3).commit()
    expect((await kv.get(['counter'])).value).toBe('8')
  })
})

describe('createKv: error mapping', () => {
  it('throws a helpful error when an RPC is not installed', async () => {
    const client: SupabaseRpcClient = {
      rpc: () =>
        Promise.resolve({
          data: null,
          error: {
            code: '42883',
            message: 'function _supabase_server_kv_get does not exist',
          },
        }),
    }
    const kv = createKv(client)
    await expect(kv.get(['anything'])).rejects.toThrow(
      /RPC '_supabase_server_kv_get' not found/,
    )
  })
})
