import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'

import { withRateLimit, createMemoryStore } from './with-rate-limit.js'

const innerOk = async () => Response.json({ ok: true })

beforeAll(() => {
  vi.useFakeTimers()
})

afterEach(() => {
  vi.setSystemTime(new Date(0))
})

describe('withRateLimit', () => {
  it('admits requests under the limit and contributes ctx.rateLimit', async () => {
    const handler = withRateLimit(
      { limit: 3, windowMs: 60_000, key: () => 'k' },
      async (_req, ctx) =>
        Response.json({ remaining: ctx.rateLimit.remaining }),
    )

    const r1 = await handler(new Request('http://localhost/'))
    const r2 = await handler(new Request('http://localhost/'))
    const r3 = await handler(new Request('http://localhost/'))

    expect(r1.status).toBe(200)
    expect(await r1.json()).toEqual({ remaining: 2 })
    expect(await r2.json()).toEqual({ remaining: 1 })
    expect(await r3.json()).toEqual({ remaining: 0 })
  })

  it('rejects with 429 + Retry-After once the limit is exceeded', async () => {
    vi.setSystemTime(new Date(1_700_000_000_000))

    const handler = withRateLimit(
      { limit: 1, windowMs: 60_000, key: () => 'k' },
      innerOk,
    )

    const ok = await handler(new Request('http://localhost/'))
    expect(ok.status).toBe(200)

    const blocked = await handler(new Request('http://localhost/'))
    expect(blocked.status).toBe(429)
    expect(blocked.headers.get('Retry-After')).toBe('60')
    expect(blocked.headers.get('X-RateLimit-Limit')).toBe('1')
    expect(blocked.headers.get('X-RateLimit-Remaining')).toBe('0')
    expect(blocked.headers.get('X-RateLimit-Reset')).toBe(
      String(Math.floor((1_700_000_000_000 + 60_000) / 1000)),
    )
    const body = await blocked.json()
    expect(body).toMatchObject({ error: 'rate_limit_exceeded', retryAfter: 60 })
  })

  it('isolates buckets by key', async () => {
    const handler = withRateLimit(
      {
        limit: 1,
        windowMs: 60_000,
        key: (req) => new URL(req.url).searchParams.get('user') ?? 'anon',
      },
      innerOk,
    )

    expect(
      (await handler(new Request('http://localhost/?user=a'))).status,
    ).toBe(200)
    expect(
      (await handler(new Request('http://localhost/?user=b'))).status,
    ).toBe(200)
    expect(
      (await handler(new Request('http://localhost/?user=a'))).status,
    ).toBe(429)
    expect(
      (await handler(new Request('http://localhost/?user=b'))).status,
    ).toBe(429)
  })

  it('resets after the window elapses', async () => {
    vi.setSystemTime(new Date(1_700_000_000_000))

    const handler = withRateLimit(
      { limit: 1, windowMs: 1_000, key: () => 'k' },
      innerOk,
    )

    expect((await handler(new Request('http://localhost/'))).status).toBe(200)
    expect((await handler(new Request('http://localhost/'))).status).toBe(429)

    vi.setSystemTime(new Date(1_700_000_001_500))
    expect((await handler(new Request('http://localhost/'))).status).toBe(200)
  })
})

describe('createMemoryStore', () => {
  it('returns a fresh window when the previous has expired', async () => {
    vi.setSystemTime(new Date(1_700_000_000_000))
    const store = createMemoryStore()

    const first = await store.hit('k', 1_000)
    expect(first).toEqual({ count: 1, resetAt: 1_700_000_001_000 })

    vi.setSystemTime(new Date(1_700_000_002_000))
    const fresh = await store.hit('k', 1_000)
    expect(fresh).toEqual({ count: 1, resetAt: 1_700_000_003_000 })
  })
})
