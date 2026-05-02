/**
 * Deno KV–shaped key/value store backed by Supabase Postgres.
 *
 * @packageDocumentation
 */

export { createKv, Kv, AtomicOperation } from './kv.js'
export type {
  CreateKvOptions,
  KvCheck,
  KvCommitResult,
  KvCommitResultFailed,
  KvCommitResultOk,
  KvEntry,
  KvEntryMaybe,
  KvListOptions,
  KvListSelector,
  KvSetOptions,
  SupabaseRpcClient,
} from './kv.js'
export { decodeKey, encodeKey } from './keys.js'
export type { Key, KeyPart } from './keys.js'
