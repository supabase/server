import { describe, expect, it } from 'vitest'

import { verifyStandardWebhook } from './verify.js'

const encoder = new TextEncoder()

function base64ToBytes(base64: string): Uint8Array<ArrayBuffer> {
  const binary = atob(base64)
  const bytes = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i)
  return bytes
}

function bytesToBase64(buffer: ArrayBuffer): string {
  const view = new Uint8Array(buffer)
  let binary = ''
  for (let i = 0; i < view.length; i++) binary += String.fromCharCode(view[i]!)
  return btoa(binary)
}

/** Produces the base64 `v1` signature for a payload, the way Supabase would. */
async function sign(
  secretBase64: string,
  id: string,
  timestamp: string,
  body: string,
): Promise<string> {
  const key = await crypto.subtle.importKey(
    'raw',
    base64ToBytes(secretBase64),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  )
  const sig = await crypto.subtle.sign(
    'HMAC',
    key,
    encoder.encode(`${id}.${timestamp}.${body}`),
  )
  return bytesToBase64(sig)
}

function headers(
  id: string | null,
  timestamp: string | null,
  signature: string | null,
): Headers {
  const h = new Headers()
  if (id !== null) h.set('webhook-id', id)
  if (timestamp !== null) h.set('webhook-timestamp', timestamp)
  if (signature !== null) h.set('webhook-signature', signature)
  return h
}

// `btoa` of an arbitrary string is valid base64; its decoded bytes are the key.
const SECRET = btoa('super-secret-key-for-tests')
const TOLERANCE = 300
const now = () => Math.floor(Date.now() / 1000).toString()
const BODY = JSON.stringify({ hello: 'world' })

describe('verifyStandardWebhook', () => {
  it('accepts a valid signature', async () => {
    const id = 'msg_1'
    const ts = now()
    const sig = await sign(SECRET, id, ts, BODY)

    const res = await verifyStandardWebhook(
      SECRET,
      BODY,
      headers(id, ts, `v1,${sig}`),
      TOLERANCE,
    )
    expect(res).toEqual({ ok: true })
  })

  it('accepts the secret with v1,whsec_ and whsec_ prefixes', async () => {
    const id = 'msg_1'
    const ts = now()
    const sig = await sign(SECRET, id, ts, BODY)
    const h = headers(id, ts, `v1,${sig}`)

    expect(
      await verifyStandardWebhook(`v1,whsec_${SECRET}`, BODY, h, TOLERANCE),
    ).toEqual({ ok: true })
    expect(
      await verifyStandardWebhook(`whsec_${SECRET}`, BODY, h, TOLERANCE),
    ).toEqual({ ok: true })
  })

  it('rejects a tampered body', async () => {
    const id = 'msg_1'
    const ts = now()
    const sig = await sign(SECRET, id, ts, BODY)

    const res = await verifyStandardWebhook(
      SECRET,
      `${BODY} tampered`,
      headers(id, ts, `v1,${sig}`),
      TOLERANCE,
    )
    expect(res).toEqual({ ok: false, reason: 'no_matching_signature' })
  })

  it('rejects a signature made with a different secret', async () => {
    const id = 'msg_1'
    const ts = now()
    const sig = await sign(btoa('a-different-secret'), id, ts, BODY)

    const res = await verifyStandardWebhook(
      SECRET,
      BODY,
      headers(id, ts, `v1,${sig}`),
      TOLERANCE,
    )
    expect(res).toEqual({ ok: false, reason: 'no_matching_signature' })
  })

  it('rejects an expired timestamp', async () => {
    const id = 'msg_1'
    const ts = (Number(now()) - 10_000).toString()
    const sig = await sign(SECRET, id, ts, BODY)

    const res = await verifyStandardWebhook(
      SECRET,
      BODY,
      headers(id, ts, `v1,${sig}`),
      TOLERANCE,
    )
    expect(res).toEqual({ ok: false, reason: 'timestamp_out_of_tolerance' })
  })

  it('rejects a far-future timestamp', async () => {
    const id = 'msg_1'
    const ts = (Number(now()) + 10_000).toString()
    const sig = await sign(SECRET, id, ts, BODY)

    const res = await verifyStandardWebhook(
      SECRET,
      BODY,
      headers(id, ts, `v1,${sig}`),
      TOLERANCE,
    )
    expect(res).toEqual({ ok: false, reason: 'timestamp_out_of_tolerance' })
  })

  it('rejects a non-numeric timestamp', async () => {
    const res = await verifyStandardWebhook(
      SECRET,
      BODY,
      headers('msg_1', 'not-a-number', 'v1,whatever'),
      TOLERANCE,
    )
    expect(res).toEqual({ ok: false, reason: 'invalid_timestamp' })
  })

  it('rejects when any required header is missing', async () => {
    const id = 'msg_1'
    const ts = now()
    const sig = `v1,${await sign(SECRET, id, ts, BODY)}`

    expect(
      await verifyStandardWebhook(
        SECRET,
        BODY,
        headers(null, ts, sig),
        TOLERANCE,
      ),
    ).toEqual({ ok: false, reason: 'missing_headers' })
    expect(
      await verifyStandardWebhook(
        SECRET,
        BODY,
        headers(id, null, sig),
        TOLERANCE,
      ),
    ).toEqual({ ok: false, reason: 'missing_headers' })
    expect(
      await verifyStandardWebhook(
        SECRET,
        BODY,
        headers(id, ts, null),
        TOLERANCE,
      ),
    ).toEqual({ ok: false, reason: 'missing_headers' })
  })

  it('accepts when one of several signatures matches (key rotation)', async () => {
    const id = 'msg_1'
    const ts = now()
    const wrong = await sign(btoa('old-rotated-out-secret'), id, ts, BODY)
    const right = await sign(SECRET, id, ts, BODY)

    const res = await verifyStandardWebhook(
      SECRET,
      BODY,
      headers(id, ts, `v1,${wrong} v1,${right}`),
      TOLERANCE,
    )
    expect(res).toEqual({ ok: true })
  })

  it('ignores non-v1 signature entries', async () => {
    const id = 'msg_1'
    const ts = now()
    const sig = await sign(SECRET, id, ts, BODY)

    const res = await verifyStandardWebhook(
      SECRET,
      BODY,
      headers(id, ts, `v2,${sig} v1,${sig}`),
      TOLERANCE,
    )
    expect(res).toEqual({ ok: true })
  })
})
