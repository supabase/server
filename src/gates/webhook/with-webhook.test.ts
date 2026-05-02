import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'

import { withWebhook } from './with-webhook.js'

const SECRET = 'whsec_test'

beforeAll(() => {
  vi.useFakeTimers()
  vi.setSystemTime(new Date(1_700_000_000_000))
})

afterEach(() => {
  vi.setSystemTime(new Date(1_700_000_000_000))
})

async function hmacHex(secret: string, payload: string): Promise<string> {
  const enc = new TextEncoder()
  const key = await crypto.subtle.importKey(
    'raw',
    enc.encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  )
  const sig = await crypto.subtle.sign('HMAC', key, enc.encode(payload))
  return Array.from(new Uint8Array(sig))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('')
}

const innerOk = async () => Response.json({ ok: true })

describe('withWebhook (stripe)', () => {
  it('admits a valid Stripe signature and contributes parsed event', async () => {
    const body = JSON.stringify({
      id: 'evt_123',
      type: 'payment_intent.succeeded',
      created: 1_700_000_000,
    })
    const t = 1_700_000_000
    const v1 = await hmacHex(SECRET, `${t}.${body}`)

    const inner = vi.fn(async (_req: Request, ctx) => {
      expect(ctx.webhook.deliveryId).toBe('evt_123')
      expect((ctx.webhook.event as { type: string }).type).toBe(
        'payment_intent.succeeded',
      )
      expect(ctx.webhook.timestamp).toBe(1_700_000_000_000)
      expect(ctx.webhook.rawBody).toBe(body)
      return Response.json({ ok: true })
    })

    const handler = withWebhook(
      { provider: { kind: 'stripe', secret: SECRET } },
      inner,
    )

    const res = await handler(
      new Request('http://localhost/', {
        method: 'POST',
        headers: { 'stripe-signature': `t=${t},v1=${v1}` },
        body,
      }),
    )

    expect(res.status).toBe(200)
    expect(inner).toHaveBeenCalledOnce()
  })

  it('rejects when the signature header is missing', async () => {
    const handler = withWebhook(
      { provider: { kind: 'stripe', secret: SECRET } },
      innerOk,
    )

    const res = await handler(
      new Request('http://localhost/', { method: 'POST', body: '{}' }),
    )

    expect(res.status).toBe(401)
    expect((await res.json()).error).toBe('signature_missing')
  })

  it('rejects on a bad signature', async () => {
    const body = '{"id":"evt_1"}'
    const t = 1_700_000_000

    const handler = withWebhook(
      { provider: { kind: 'stripe', secret: SECRET } },
      innerOk,
    )

    const res = await handler(
      new Request('http://localhost/', {
        method: 'POST',
        headers: { 'stripe-signature': `t=${t},v1=deadbeef` },
        body,
      }),
    )

    expect(res.status).toBe(401)
    expect((await res.json()).error).toBe('signature_invalid')
  })

  it('rejects when the timestamp is outside the tolerance window', async () => {
    const body = '{"id":"evt_1"}'
    const t = 1_700_000_000 - 600 // 10 min ago, default tolerance is 5 min
    const v1 = await hmacHex(SECRET, `${t}.${body}`)

    const handler = withWebhook(
      { provider: { kind: 'stripe', secret: SECRET } },
      innerOk,
    )

    const res = await handler(
      new Request('http://localhost/', {
        method: 'POST',
        headers: { 'stripe-signature': `t=${t},v1=${v1}` },
        body,
      }),
    )

    expect(res.status).toBe(401)
    expect((await res.json()).error).toBe('signature_expired')
  })

  it('accepts any of multiple secrets (rotation)', async () => {
    const body = '{"id":"evt_rot"}'
    const t = 1_700_000_000
    const oldSecret = 'whsec_old'
    const v1 = await hmacHex(oldSecret, `${t}.${body}`)

    const handler = withWebhook(
      { provider: { kind: 'stripe', secret: ['whsec_new', oldSecret] } },
      innerOk,
    )

    const res = await handler(
      new Request('http://localhost/', {
        method: 'POST',
        headers: { 'stripe-signature': `t=${t},v1=${v1}` },
        body,
      }),
    )

    expect(res.status).toBe(200)
  })
})

describe('withWebhook (custom)', () => {
  it('passes when the custom verifier returns ok', async () => {
    const verify = vi.fn(async (_req: Request, body: string) => ({
      ok: true as const,
      event: JSON.parse(body),
      deliveryId: 'd-1',
      timestamp: 1_700_000_000_000,
    }))

    const inner = vi.fn(async (_req: Request, ctx) => {
      expect(ctx.webhook.deliveryId).toBe('d-1')
      return Response.json({ ok: true })
    })

    const handler = withWebhook({ provider: { kind: 'custom', verify } }, inner)

    const res = await handler(
      new Request('http://localhost/', {
        method: 'POST',
        body: '{"hi":1}',
      }),
    )

    expect(res.status).toBe(200)
    expect(verify).toHaveBeenCalledOnce()
  })

  it('rejects when the custom verifier returns failure', async () => {
    const handler = withWebhook(
      {
        provider: {
          kind: 'custom',
          verify: () => ({ ok: false, status: 403, error: 'forbidden' }),
        },
      },
      innerOk,
    )

    const res = await handler(
      new Request('http://localhost/', { method: 'POST', body: '{}' }),
    )

    expect(res.status).toBe(403)
    expect((await res.json()).error).toBe('forbidden')
  })
})
