import { afterEach, describe, expect, it, vi } from 'vitest'

import { beforeUserCreated, afterUserCreated } from './auth-hooks.js'

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

describe('beforeUserCreated', () => {
  afterEach(() => {
    vi.unstubAllEnvs()
  })

  function stubEnv() {
    vi.stubEnv('SUPABASE_URL', 'https://test.supabase.co')
    vi.stubEnv('SUPABASE_PUBLISHABLE_KEYS', 'pk_test')
    vi.stubEnv('SUPABASE_SECRET_KEYS', 'sk_test')
  }

  it('calls handler with userData on valid signature', async () => {
    const secret = 'test-secret'
    const payload = JSON.stringify({
      user: { id: 'user-123', email: 'test@test.com' },
    })
    const signature = await sign(payload, secret)

    stubEnv()

    const handler = beforeUserCreated(
      async (_req, ctx) => {
        expect(ctx.userData.user.id).toBe('user-123')
        return { decision: 'continue' as const }
      },
      { webhookSecret: secret },
    )

    const req = new Request('http://localhost', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-supabase-signature': signature,
      },
      body: payload,
    })

    const res = await handler(req)
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.decision).toBe('continue')
  })

  it('returns 401 on invalid signature', async () => {
    stubEnv()

    const handler = beforeUserCreated(
      async () => ({ decision: 'continue' as const }),
      { webhookSecret: 'test-secret' },
    )

    const req = new Request('http://localhost', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-supabase-signature': 'invalid',
      },
      body: JSON.stringify({ user: { id: '123' } }),
    })

    const res = await handler(req)
    expect(res.status).toBe(401)
  })

  it('returns 403 when handler rejects', async () => {
    const secret = 'test-secret'
    const payload = JSON.stringify({ user: { id: 'user-123' } })
    const signature = await sign(payload, secret)

    stubEnv()

    const handler = beforeUserCreated(
      async () => ({
        decision: 'reject' as const,
        message: 'Not allowed',
      }),
      { webhookSecret: secret },
    )

    const req = new Request('http://localhost', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-supabase-signature': signature,
      },
      body: payload,
    })

    const res = await handler(req)
    expect(res.status).toBe(403)
    const body = await res.json()
    expect(body.decision).toBe('reject')
    expect(body.message).toBe('Not allowed')
  })
})

describe('afterUserCreated', () => {
  it('is a function', () => {
    expect(typeof afterUserCreated).toBe('function')
  })
})
