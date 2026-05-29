/**
 * Standard Webhooks signature verification — the scheme Supabase Auth Hooks
 * use over HTTP. Kept separate from the gate so the security-critical logic is
 * unit-testable in isolation.
 *
 * @packageDocumentation
 */

import { timingSafeEqual } from '../../core/utils/timing-safe-equal.js'

const encoder = new TextEncoder()

/**
 * Outcome of a verification attempt. `reason` is a stable machine code for the
 * failure mode — never surfaced to the caller of the webhook, only useful for
 * the gate's own logging/branching.
 *
 * @internal
 */
export type VerifyResult = { ok: true } | { ok: false; reason: string }

/**
 * Decodes a base64 string to raw bytes — turns the secret's base64 key
 * material into the HMAC key.
 *
 * @internal
 */
function base64ToBytes(base64: string): Uint8Array<ArrayBuffer> {
  const binary = atob(base64)
  const bytes = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i)
  }
  return bytes
}

/**
 * Encodes raw bytes to base64 — renders the computed HMAC as the base64
 * signature Standard Webhooks compares against.
 *
 * @internal
 */
function bytesToBase64(buffer: ArrayBuffer): string {
  const view = new Uint8Array(buffer)
  let binary = ''
  for (let i = 0; i < view.length; i++) {
    binary += String.fromCharCode(view[i]!)
  }
  return btoa(binary)
}

/**
 * Strips the Supabase/Standard Webhooks secret prefixes and returns the raw
 * HMAC key bytes. Accepts `v1,whsec_<base64>`, `whsec_<base64>`, or a bare
 * `<base64>` — the `v1,` version tag and `whsec_` prefix are not key material.
 *
 * @internal
 */
function secretToKeyBytes(secret: string): Uint8Array<ArrayBuffer> {
  let base64 = secret
  if (base64.startsWith('v1,')) base64 = base64.slice(3)
  if (base64.startsWith('whsec_')) base64 = base64.slice('whsec_'.length)
  return base64ToBytes(base64)
}

/**
 * Verifies a Standard Webhooks signature.
 *
 * Recomputes `HMAC-SHA256(key, `${id}.${timestamp}.${rawBody}`)`, base64-encodes
 * it, and constant-time compares it against the `v1` entries in the
 * `webhook-signature` header. Three guards beyond the HMAC itself:
 *
 * - **Headers present.** `webhook-id`, `webhook-timestamp`, `webhook-signature`
 *   must all exist.
 * - **Replay window.** The timestamp must be within `toleranceSeconds` of now,
 *   so a captured request can't be replayed indefinitely.
 * - **Key rotation.** `webhook-signature` may list several space-delimited
 *   signatures; admit if *any* `v1` entry matches.
 *
 * @internal
 */
export async function verifyStandardWebhook(
  secret: string,
  rawBody: string,
  headers: Headers,
  toleranceSeconds: number,
): Promise<VerifyResult> {
  const id = headers.get('webhook-id')
  const timestamp = headers.get('webhook-timestamp')
  const signatureHeader = headers.get('webhook-signature')

  if (!id || !timestamp || !signatureHeader) {
    return { ok: false, reason: 'missing_headers' }
  }

  const ts = Number(timestamp)
  if (!Number.isFinite(ts)) {
    return { ok: false, reason: 'invalid_timestamp' }
  }
  const now = Math.floor(Date.now() / 1000)
  if (Math.abs(now - ts) > toleranceSeconds) {
    return { ok: false, reason: 'timestamp_out_of_tolerance' }
  }

  let keyBytes: Uint8Array<ArrayBuffer>
  try {
    keyBytes = secretToKeyBytes(secret)
  } catch {
    return { ok: false, reason: 'invalid_secret' }
  }

  const cryptoKey = await crypto.subtle.importKey(
    'raw',
    keyBytes,
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  )
  const signed = encoder.encode(`${id}.${timestamp}.${rawBody}`)
  const signature = await crypto.subtle.sign('HMAC', cryptoKey, signed)
  const expected = bytesToBase64(signature)

  // `webhook-signature` is a space-delimited list of `<version>,<base64sig>`
  // entries — more than one while a secret is being rotated. Admit on the first
  // matching `v1` entry.
  for (const entry of signatureHeader.split(' ')) {
    const comma = entry.indexOf(',')
    if (comma === -1) continue
    if (entry.slice(0, comma) !== 'v1') continue
    const candidate = entry.slice(comma + 1)
    if (await timingSafeEqual(expected, candidate)) {
      return { ok: true }
    }
  }

  return { ok: false, reason: 'no_matching_signature' }
}
