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

const { seedContext } = await import('@supabase/middleware')
const { withPostgres } = await import('./index.js')

describe('withPostgres', () => {
  beforeEach(() => {
    h.issued.length = 0
    h.clientQuery.mockClear()
    h.connect.mockClear()
    h.release.mockClear()
    // The connection-string default reads the importable getEnv, which falls
    // back to the host env in tests.
    vi.stubEnv('SUPABASE_DB_URL', 'postgres://localhost/test')
  })
  afterEach(() => {
    vi.unstubAllEnvs()
    vi.restoreAllMocks()
  })

  it('returns 500 when no connection string is available', async () => {
    vi.stubEnv('SUPABASE_DB_URL', undefined)
    const handler = withPostgres({ connectionString: undefined }, async () =>
      Response.json({ ok: true }),
    )

    const res = await handler(new Request('http://localhost'), {
      ...seedContext(),
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
      ...seedContext(),
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
      ...seedContext(),
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
        ...seedContext(),
        jwtClaims: { role: 'authenticated' },
      }),
    ).rejects.toThrow('boom')

    expect(h.issued).toContain('rollback')
    expect(h.release).toHaveBeenCalled()
  })

  it('appends a grants hint to permission-denied (42501) errors', async () => {
    // begin, set_config, set role succeed; the user query hits missing grants.
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
        const err = new Error('permission denied for table notes') as Error & {
          code: string
        }
        err.code = '42501'
        throw err
      })

    const handler = withPostgres(async (_req, ctx) => {
      await ctx.postgres.query('select * from notes')
      return Response.json({ ok: true })
    })

    await expect(
      handler(new Request('http://localhost'), {
        ...seedContext(),
        jwtClaims: { role: 'authenticated' },
      }),
    ).rejects.toThrow(
      /permission denied for table notes \(RLS-scoped queries run as the caller's role 'authenticated'/,
    )

    expect(h.issued).toContain('rollback')
    expect(h.release).toHaveBeenCalled()
  })
})
