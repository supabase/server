/**
 * Key encoding for the KV store.
 *
 * Deno KV keys are arrays of (string | number | bigint | boolean | Uint8Array).
 * We encode them to a single `text` column so we can lean on Postgres B-tree
 * indexes for prefix queries.
 *
 * Encoding rules:
 *   - Each part is type-tagged then percent-escaped.
 *   - Parts are joined by `/`.
 *   - The encoded key always ends in `/` so prefix-of relationships are
 *     exact: `encode(['a'])` is a strict prefix of `encode(['a', 'b'])` but
 *     NOT of `encode(['ab'])`.
 *
 * Type tags:
 *   - `s.` string
 *   - `n.` number  (decimal — ordering across numbers is NOT byte-stable;
 *     range queries on numeric keys are best-effort, see README)
 *   - `i.` bigint
 *   - `b.` boolean (`0` or `1`)
 *   - `x.` Uint8Array (hex)
 *
 * Within each part, `/`, `%`, and any control character are percent-escaped.
 * This keeps encoded keys printable, JSON-safe, and free of NUL bytes (which
 * Postgres `text` columns reject).
 */

/** A single key part as accepted by Deno KV. */
export type KeyPart = string | number | bigint | boolean | Uint8Array

/** A full hierarchical key, as accepted by Deno KV. */
export type Key = readonly KeyPart[]

const SAFE = /^[A-Za-z0-9._~-]$/

function escapePart(s: string): string {
  let out = ''
  for (const ch of s) {
    if (ch === '/' || ch === '%' || !SAFE.test(ch)) {
      for (const byte of new TextEncoder().encode(ch)) {
        out += '%' + byte.toString(16).padStart(2, '0').toUpperCase()
      }
    } else {
      out += ch
    }
  }
  return out
}

function unescapePart(s: string): string {
  return decodeURIComponent(s)
}

function encodePart(part: KeyPart): string {
  if (typeof part === 'string') return 's.' + escapePart(part)
  if (typeof part === 'number') {
    if (!Number.isFinite(part)) {
      throw new TypeError('KV key part must be a finite number')
    }
    return 'n.' + escapePart(String(part))
  }
  if (typeof part === 'bigint') return 'i.' + escapePart(part.toString())
  if (typeof part === 'boolean') return 'b.' + (part ? '1' : '0')
  if (part instanceof Uint8Array) {
    let hex = ''
    for (const byte of part) hex += byte.toString(16).padStart(2, '0')
    return 'x.' + hex
  }
  throw new TypeError(
    `KV key part must be string | number | bigint | boolean | Uint8Array, got ${typeof part}`,
  )
}

function decodePart(encoded: string): KeyPart {
  if (encoded.length < 2 || encoded[1] !== '.') {
    throw new Error(`malformed KV key part: ${encoded}`)
  }
  const tag = encoded[0]
  const body = encoded.slice(2)
  switch (tag) {
    case 's':
      return unescapePart(body)
    case 'n':
      return Number(unescapePart(body))
    case 'i':
      return BigInt(unescapePart(body))
    case 'b':
      return body === '1'
    case 'x': {
      if (body.length % 2 !== 0) {
        throw new Error(`malformed bytes part: ${encoded}`)
      }
      const out = new Uint8Array(body.length / 2)
      for (let i = 0; i < out.length; i++) {
        out[i] = parseInt(body.slice(i * 2, i * 2 + 2), 16)
      }
      return out
    }
    default:
      throw new Error(`unknown KV key tag: ${tag}`)
  }
}

/**
 * Encode a hierarchical key to its on-disk text form. The result always ends
 * in `/` so it is a clean prefix of any longer key with the same parts.
 */
export function encodeKey(key: Key): string {
  if (key.length === 0) return ''
  let out = ''
  for (const part of key) {
    out += encodePart(part) + '/'
  }
  return out
}

/**
 * Decode an on-disk text key back to its part array. Inverse of `encodeKey`.
 */
export function decodeKey(encoded: string): KeyPart[] {
  if (encoded === '') return []
  if (!encoded.endsWith('/')) {
    throw new Error(`malformed encoded key (missing trailing /): ${encoded}`)
  }
  const parts = encoded.slice(0, -1).split('/')
  return parts.map(decodePart)
}
