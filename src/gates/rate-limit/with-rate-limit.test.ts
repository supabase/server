import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'

import { withRateLimit, type SupabaseRpcClient } from './with-rate-limit.js'

const innerOk = async () => Response.json({ ok: true })

beforeAll(() => {
  vi.useFakeTimers()
  vi.setSystemTime(new Date(1_700_000_000_000))
})

afterEach(() => {
  vi.setSystemTime(new Date(1_700_000_000_000))
})

/**
 * In-memory fake of the Supabase RPC client that mimics the SQL function
 * the gate expects.
 */
function makeFakeAdmin(): SupabaseRpcClient & {
  rpc: ReturnType<typeof vi.fn>
} {
  const buckets = new Map<string, { count: number; reset_at: number }>()
  const rpc = vi.fn(
    async (
      _fn: string,
      args: { p_key: string; p_window_ms: number },
    ): Promise<{ data: { count: number; reset_at: number }; error: null }> => {
      const now = Date.now()
      const existing = buckets.get(args.p_key)
      let next: { count: number; reset_at: number }
      if (!existing || existing.reset_at <= now) {
        next = { count: 1, reset_at: now + args.p_window_ms }
      } else {
        next = { count: existing.count + 1, reset_at: existing.reset_at }
      }
      buckets.set(args.p_key, next)
      return { data: { ...next }, error: null }
    },
  )
  return { rpc } as SupabaseRpcClient & { rpc: typeof rpc }
}

describe('withRateLimit', () => {
  it('admits requests under the limit and contributes ctx.rateLimit', async () => {
    const supabaseAdmin = makeFakeAdmin()
    const handler = withRateLimit(
      { limit: 3, windowMs: 60_000, key: () => 'k' },
      async (_req, ctx) =>
        Response.json({ remaining: ctx.rateLimit.remaining }),
    )

    const r1 = await handler(new Request('http://localhost/'), {
      supabaseAdmin,
    })
    const r2 = await handler(new Request('http://localhost/'), {
      supabaseAdmin,
    })
    const r3 = await handler(new Request('http://localhost/'), {
      supabaseAdmin,
    })

    expect(r1.status).toBe(200)
    expect(await r1.json()).toEqual({ remaining: 2 })
    expect(await r2.json()).toEqual({ remaining: 1 })
    expect(await r3.json()).toEqual({ remaining: 0 })
    expect(supabaseAdmin.rpc).toHaveBeenCalledTimes(3)
  })

  it('rejects with 429 + Retry-After once the limit is exceeded', async () => {
    const supabaseAdmin = makeFakeAdmin()
    const handler = withRateLimit(
      { limit: 1, windowMs: 60_000, key: () => 'k' },
      innerOk,
    )

    const ok = await handler(new Request('http://localhost/'), {
      supabaseAdmin,
    })
    expect(ok.status).toBe(200)

    const blocked = await handler(new Request('http://localhost/'), {
      supabaseAdmin,
    })
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
    const supabaseAdmin = makeFakeAdmin()
    const handler = withRateLimit(
      {
        limit: 1,
        windowMs: 60_000,
        key: (req) => new URL(req.url).searchParams.get('user') ?? 'anon',
      },
      innerOk,
    )

    expect(
      (
        await handler(new Request('http://localhost/?user=a'), {
          supabaseAdmin,
        })
      ).status,
    ).toBe(200)
    expect(
      (
        await handler(new Request('http://localhost/?user=b'), {
          supabaseAdmin,
        })
      ).status,
    ).toBe(200)
    expect(
      (
        await handler(new Request('http://localhost/?user=a'), {
          supabaseAdmin,
        })
      ).status,
    ).toBe(429)
    expect(
      (
        await handler(new Request('http://localhost/?user=b'), {
          supabaseAdmin,
        })
      ).status,
    ).toBe(429)
  })

  it('honors a custom rpc name', async () => {
    const supabaseAdmin = makeFakeAdmin()
    const handler = withRateLimit(
      {
        limit: 1,
        windowMs: 60_000,
        key: () => 'k',
        rpc: 'my_custom_rate_limit',
      },
      innerOk,
    )

    await handler(new Request('http://localhost/'), { supabaseAdmin })
    expect(supabaseAdmin.rpc).toHaveBeenCalledWith('my_custom_rate_limit', {
      p_key: 'k',
      p_window_ms: 60_000,
    })
  })

  it('throws a helpful error when the rpc is missing', async () => {
    const supabaseAdmin = {
      rpc: vi.fn(async () => ({
        data: null,
        error: {
          code: '42883',
          message: 'function _supabase_server_rate_limit_hit does not exist',
        },
      })),
    } satisfies SupabaseRpcClient
    const handler = withRateLimit(
      { limit: 1, windowMs: 60_000, key: () => 'k' },
      innerOk,
    )

    await expect(
      handler(new Request('http://localhost/'), { supabaseAdmin }),
    ).rejects.toThrow(/RPC .* not found/)
  })
})
