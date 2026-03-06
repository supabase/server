import { describe, expect, it } from 'vitest'

import { verifyWebhookSignature } from './webhook.js'

const encoder = new TextEncoder()

async function sign(payload: string, secret: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    'raw',
    encoder.encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  )
  const sig = await crypto.subtle.sign('HMAC', key, encoder.encode(payload))
  return Array.from(new Uint8Array(sig))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('')
}

describe('verifyWebhookSignature', () => {
  it('verifies valid signature', async () => {
    const payload = '{"user":{"id":"123"}}'
    const secret = 'webhook-secret'
    const signature = await sign(payload, secret)
    expect(await verifyWebhookSignature(payload, signature, secret)).toBe(true)
  })

  it('rejects invalid signature', async () => {
    const payload = '{"user":{"id":"123"}}'
    const secret = 'webhook-secret'
    expect(await verifyWebhookSignature(payload, 'bad-sig', secret)).toBe(false)
  })

  it('rejects signature with wrong secret', async () => {
    const payload = '{"user":{"id":"123"}}'
    const signature = await sign(payload, 'correct-secret')
    expect(
      await verifyWebhookSignature(payload, signature, 'wrong-secret'),
    ).toBe(false)
  })
})
