/**
 * Deno KV–shaped key/value store backed by Supabase Postgres.
 *
 * Storage is a single table (`_supabase_server_kv`) with a `text` primary
 * key, a `jsonb` value, a `bigint` versionstamp, and an optional
 * `timestamptz expires_at`. Three RPCs (`_get`, `_list`, `_atomic`) provide
 * the read, scan, and atomic-commit primitives.
 *
 * @see src/kv/README.md for the migration.
 *
 * @example
 * ```ts
 * import { withSupabase } from '@supabase/server'
 * import { createKv } from '@supabase/server/kv'
 *
 * export default {
 *   fetch: withSupabase({ allow: 'user' }, async (req, ctx) => {
 *     const kv = createKv({ supabaseAdmin: ctx.supabaseAdmin })
 *     await kv.set(['users', ctx.userClaims!.id, 'lastSeen'], Date.now())
 *     return Response.json({ ok: true })
 *   }),
 * }
 * ```
 */

import { decodeKey, encodeKey, type Key, type KeyPart } from './keys.js'

const DEFAULT_RPCS = {
  get: '_supabase_server_kv_get',
  list: '_supabase_server_kv_list',
  atomic: '_supabase_server_kv_atomic',
} as const

/**
 * Structural subset of the Supabase admin client surface used by KV. Typed
 * as `PromiseLike` so `supabase-js`'s `PostgrestFilterBuilder` (a thenable,
 * not a strict `Promise`) satisfies it.
 */
export interface SupabaseRpcClient {
  rpc<T = unknown>(
    fn: string,
    args?: Record<string, unknown>,
  ): PromiseLike<{
    data: T | null
    error: { message: string; code?: string } | null
  }>
}

export interface CreateKvOptions {
  /**
   * Supabase admin client. Must bypass RLS — passing a user-scoped client
   * silently returns empty reads and fails writes against the locked-down
   * `_supabase_server_kv` table.
   */
  supabaseAdmin: SupabaseRpcClient

  /** Override the RPC names if you renamed them in the migration. */
  rpcs?: Partial<typeof DEFAULT_RPCS>
}

/** A KV entry that exists. */
export interface KvEntry<T> {
  key: KeyPart[]
  value: T
  versionstamp: string
}

/** A KV entry that may be absent. */
export interface KvEntryMaybe<T> {
  key: KeyPart[]
  value: T | null
  versionstamp: string | null
}

export interface KvSetOptions {
  /** TTL for the entry, in milliseconds. */
  expireIn?: number
}

export interface KvListSelector {
  /** Match all keys whose parts begin with these. */
  prefix?: Key
  /** Inclusive lower bound. */
  start?: Key
  /** Exclusive upper bound. */
  end?: Key
}

export interface KvListOptions {
  /** Stop after this many entries. */
  limit?: number
  /** Continue from a previous list iteration. */
  cursor?: string
  /** Iterate in reverse order. */
  reverse?: boolean
}

export interface KvCommitResultOk {
  ok: true
  versionstamp: string
}

export interface KvCommitResultFailed {
  ok: false
}

export type KvCommitResult = KvCommitResultOk | KvCommitResultFailed

export interface KvCheck {
  key: Key
  /** `null` means "expect this key to not exist". */
  versionstamp: string | null
}

interface RawEntry {
  key: string
  value: unknown
  versionstamp: string
}

interface AtomicOp {
  type: 'set' | 'delete' | 'sum'
  key: Key
  value?: unknown
  expireIn?: number
}

/**
 * Atomic commit builder. Mirrors `Deno.Kv.atomic()`.
 *
 * Operations grouped on the same builder commit as a single SQL statement:
 * either every `check` passes and every mutation lands, or none do.
 */
export class AtomicOperation {
  private readonly checks: KvCheck[] = []
  private readonly ops: AtomicOp[] = []

  constructor(
    private readonly client: SupabaseRpcClient,
    private readonly rpc: string,
  ) {}

  /**
   * Require an entry to be at the given versionstamp at commit time.
   * `versionstamp: null` requires the entry to not exist.
   */
  check(...checks: KvCheck[]): this {
    this.checks.push(...checks)
    return this
  }

  /** Schedule a `set`. */
  set(key: Key, value: unknown, options?: KvSetOptions): this {
    this.ops.push({ type: 'set', key, value, expireIn: options?.expireIn })
    return this
  }

  /** Schedule a `delete`. */
  delete(key: Key): this {
    this.ops.push({ type: 'delete', key })
    return this
  }

  /**
   * Atomically add `n` to the integer at `key`. The current value (if any)
   * must be a number or numeric string; missing keys are treated as `0`.
   */
  sum(key: Key, n: bigint | number): this {
    this.ops.push({ type: 'sum', key, value: BigInt(n).toString() })
    return this
  }

  /**
   * Commit the operation. Returns `{ ok: true, versionstamp }` if every
   * check passed, `{ ok: false }` otherwise.
   */
  async commit(): Promise<KvCommitResult> {
    const args = buildAtomicArgs(this.checks, this.ops)
    const { data, error } = await this.client.rpc<{
      ok: boolean
      versionstamp?: string
    }>(this.rpc, args)
    if (error) throw rpcError(this.rpc, error)
    if (!data) throw new Error(`createKv: '${this.rpc}' returned no data`)
    if (data.ok && data.versionstamp) {
      return { ok: true, versionstamp: data.versionstamp }
    }
    return { ok: false }
  }
}

/** A KV store wrapper around a Supabase admin client. */
export class Kv {
  constructor(
    private readonly client: SupabaseRpcClient,
    private readonly rpcs: typeof DEFAULT_RPCS,
  ) {}

  /** Fetch a single entry. Returns `value: null, versionstamp: null` when missing. */
  async get<T = unknown>(key: Key): Promise<KvEntryMaybe<T>> {
    const [entry] = await this.getMany<[T]>([key])
    return entry
  }

  /** Fetch multiple entries in one round-trip. Order matches the input. */
  async getMany<T extends readonly unknown[]>(keys: {
    readonly [K in keyof T]: Key
  }): Promise<{ -readonly [K in keyof T]: KvEntryMaybe<T[K]> }> {
    const encoded = keys.map(encodeKey)
    const { data, error } = await this.client.rpc<RawEntry[]>(this.rpcs.get, {
      p_keys: encoded,
    })
    if (error) throw rpcError(this.rpcs.get, error)
    const rows = data ?? []
    const byKey = new Map(rows.map((r) => [r.key, r]))
    return keys.map((k, i) => {
      const row = byKey.get(encoded[i])
      if (!row) return { key: [...k], value: null, versionstamp: null }
      return {
        key: decodeKey(row.key),
        value: row.value,
        versionstamp: row.versionstamp,
      }
    }) as { -readonly [K in keyof T]: KvEntryMaybe<T[K]> }
  }

  /** Write a value. Equivalent to `kv.atomic().set(...).commit()`. */
  async set(
    key: Key,
    value: unknown,
    options?: KvSetOptions,
  ): Promise<KvCommitResultOk> {
    const result = await this.atomic().set(key, value, options).commit()
    if (!result.ok) {
      throw new Error('createKv: unconditional set unexpectedly failed')
    }
    return result
  }

  /** Delete an entry. No-op if absent. */
  async delete(key: Key): Promise<void> {
    const result = await this.atomic().delete(key).commit()
    if (!result.ok) {
      throw new Error('createKv: unconditional delete unexpectedly failed')
    }
  }

  /**
   * Async-iterate entries matching the selector.
   *
   * @example
   * ```ts
   * for await (const entry of kv.list({ prefix: ['users'] })) {
   *   console.log(entry.key, entry.value)
   * }
   * ```
   */
  list<T = unknown>(
    selector: KvListSelector,
    options: KvListOptions = {},
  ): AsyncIterableIterator<KvEntry<T>> & { readonly cursor: string } {
    return new KvListIterator<T>(this.client, this.rpcs.list, selector, options)
  }

  /** Begin an atomic transaction. */
  atomic(): AtomicOperation {
    return new AtomicOperation(this.client, this.rpcs.atomic)
  }
}

/**
 * Build a KV store backed by a Supabase admin client.
 *
 * @example
 * ```ts
 * const kv = createKv({ supabaseAdmin: ctx.supabaseAdmin })
 * ```
 */
export function createKv(options: CreateKvOptions): Kv {
  return new Kv(options.supabaseAdmin, { ...DEFAULT_RPCS, ...options.rpcs })
}

class KvListIterator<T> implements AsyncIterableIterator<KvEntry<T>> {
  private buffer: KvEntry<T>[] = []
  private nextCursor: string | null
  private done = false
  private remaining: number

  constructor(
    private readonly client: SupabaseRpcClient,
    private readonly rpc: string,
    private readonly selector: KvListSelector,
    private readonly options: KvListOptions,
  ) {
    this.nextCursor = options.cursor ?? null
    this.remaining = options.limit ?? Infinity
  }

  get cursor(): string {
    return this.nextCursor ?? ''
  }

  [Symbol.asyncIterator](): this {
    return this
  }

  async next(): Promise<IteratorResult<KvEntry<T>>> {
    if (this.buffer.length === 0 && !this.done && this.remaining > 0) {
      await this.fetch()
    }
    if (this.buffer.length === 0 || this.remaining <= 0) {
      return { done: true, value: undefined }
    }
    this.remaining -= 1
    return { done: false, value: this.buffer.shift()! }
  }

  private async fetch(): Promise<void> {
    const batchSize = Math.min(this.remaining, 500)
    const { data, error } = await this.client.rpc<{
      entries: RawEntry[]
      cursor: string | null
    }>(this.rpc, {
      p_prefix: this.selector.prefix ? encodeKey(this.selector.prefix) : null,
      p_start: this.selector.start ? encodeKey(this.selector.start) : null,
      p_end: this.selector.end ? encodeKey(this.selector.end) : null,
      p_limit: batchSize,
      p_reverse: this.options.reverse ?? false,
      p_cursor: this.nextCursor,
    })
    if (error) throw rpcError(this.rpc, error)
    if (!data) {
      this.done = true
      return
    }
    this.buffer = data.entries.map((e) => ({
      key: decodeKey(e.key),
      value: e.value as T,
      versionstamp: e.versionstamp,
    }))
    this.nextCursor = data.cursor
    if (data.cursor === null) this.done = true
  }
}

function buildAtomicArgs(
  checks: KvCheck[],
  ops: AtomicOp[],
): Record<string, unknown> {
  const p_checks: Record<string, string | null> = {}
  for (const c of checks) {
    p_checks[encodeKey(c.key)] = c.versionstamp
  }

  const p_sets: Record<string, unknown> = {}
  const p_set_expires: Record<string, number> = {}
  const p_sums: Record<string, string> = {}
  const p_deletes: string[] = []

  for (const op of ops) {
    const k = encodeKey(op.key)
    if (op.type === 'set') {
      p_sets[k] = op.value
      if (op.expireIn !== undefined) {
        p_set_expires[k] = Date.now() + op.expireIn
      }
    } else if (op.type === 'delete') {
      p_deletes.push(k)
    } else {
      p_sums[k] = op.value as string
    }
  }

  return {
    p_checks,
    p_sets,
    p_set_expires,
    p_deletes,
    p_sums,
  }
}

function rpcError(
  rpc: string,
  error: { message: string; code?: string },
): Error {
  if (
    error.code === '42883' ||
    error.message.toLowerCase().includes('function')
  ) {
    return new Error(
      `createKv: RPC '${rpc}' not found. Install the migration from ` +
        `src/kv/README.md before calling.`,
    )
  }
  return new Error(`createKv: '${rpc}' failed: ${error.message}`)
}
