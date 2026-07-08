import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

// Shared mock state, hoisted so the vi.mock factory can close over it.
const h = vi.hoisted(() => {
  const issued: string[] = []
  const clientQuery = vi.fn(async (text: string) => {
    issued.push(text)
    return { rows: [{ ok: true }] }
  })
  const release = vi.fn()
  const connect = vi.fn(async () => ({ query: clientQuery, release }))
  return { issued, clientQuery, release, connect }
})

vi.mock('pg', () => {
  class Pool {
    connect = h.connect
  }
  return { default: { Pool }, Pool }
})

const runtime = {
  name: 'node' as const,
  getEnv: (k: string) =>
    k === 'SUPABASE_DB_URL' ? 'postgres://localhost/test' : undefined,
}

const { withPostgres } = await import('./index.js')

describe('withPostgres', () => {
  beforeEach(() => {
    h.issued.length = 0
    h.clientQuery.mockClear()
    h.connect.mockClear()
    h.release.mockClear()
  })
  afterEach(() => vi.restoreAllMocks())

  it('returns 500 when no connection string is available', async () => {
    const handler = withPostgres({ connectionString: undefined }, async () =>
      Response.json({ ok: true }),
    )

    const res = await handler(new Request('http://localhost'), {
      _runtime: { name: 'node', getEnv: () => undefined },
      jwtClaims: null,
    })

    expect(res.status).toBe(500)
    expect(await res.json()).toEqual({ error: 'no SUPABASE_DB_URL' })
  })

  it('injects the caller claims and drops to the authenticated role', async () => {
    const handler = withPostgres(async (_req, ctx) => {
      await ctx.postgres.query('select 1')
      return Response.json({ ok: true })
    })

    await handler(new Request('http://localhost'), {
      _runtime: runtime,
      jwtClaims: { sub: 'u1', role: 'authenticated' },
    })

    expect(h.issued).toEqual([
      'begin',
      `select set_config('request.jwt.claims', $1, true)`,
      'set local role authenticated',
      'select 1',
      'commit',
    ])
    expect(h.release).toHaveBeenCalled()
  })

  it('clamps any non-authenticated role (incl. a forged service_role) to anon', async () => {
    const handler = withPostgres(async (_req, ctx) => {
      await ctx.postgres.query('select 1')
      return Response.json({ ok: true })
    })

    await handler(new Request('http://localhost'), {
      _runtime: runtime,
      jwtClaims: { sub: 'attacker', role: 'service_role' },
    })

    expect(h.issued).toContain('set local role anon')
    expect(h.issued).not.toContain('set local role service_role')
  })

  it('rolls back when the query throws', async () => {
    // begin, set_config, set role succeed; the user query throws.
    h.clientQuery
      .mockImplementationOnce(async (t: string) => {
        h.issued.push(t)
        return { rows: [] }
      })
      .mockImplementationOnce(async (t: string) => {
        h.issued.push(t)
        return { rows: [] }
      })
      .mockImplementationOnce(async (t: string) => {
        h.issued.push(t)
        return { rows: [] }
      })
      .mockImplementationOnce(async () => {
        throw new Error('boom')
      })

    const handler = withPostgres(async (_req, ctx) => {
      await ctx.postgres.query('select bad')
      return Response.json({ ok: true })
    })

    await expect(
      handler(new Request('http://localhost'), {
        _runtime: runtime,
        jwtClaims: { role: 'authenticated' },
      }),
    ).rejects.toThrow('boom')

    expect(h.issued).toContain('rollback')
    expect(h.release).toHaveBeenCalled()
  })
})
