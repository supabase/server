import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

// Shared mock state, hoisted so the vi.mock factory can close over it.
const h = vi.hoisted(() => {
  const issued: string[] = []
  const params: (unknown[] | undefined)[] = []
  const pooled: string[] = []
  // pool.query — the admin path never checks a client out itself.
  const poolQuery = vi.fn(async (text: string, p?: unknown[]) => {
    issued.push(text)
    params.push(p)
    return { rows: [{ ok: true }] }
  })
  const connect = vi.fn()
  return { issued, params, pooled, poolQuery, connect }
})

vi.mock('pg', () => {
  class Pool {
    query = h.poolQuery
    connect = h.connect
    constructor(config: { connectionString: string }) {
      h.pooled.push(config.connectionString)
    }
  }
  return { default: { Pool }, Pool }
})

const { seedContext } = await import('@supabase/middleware')
const { withPostgresAdminClient } = await import('./index.js')

describe('withPostgresAdminClient', () => {
  beforeEach(() => {
    h.issued.length = 0
    h.params.length = 0
    h.poolQuery.mockClear()
    h.connect.mockClear()
    vi.stubEnv('SUPABASE_DB_URL', 'postgres://localhost/test')
  })
  afterEach(() => {
    vi.unstubAllEnvs()
    vi.restoreAllMocks()
  })

  it('returns 500 when no connection string is available', async () => {
    vi.stubEnv('SUPABASE_DB_URL', undefined)
    const handler = withPostgresAdminClient(
      { connectionString: undefined },
      async () => Response.json({ ok: true }),
    )

    const res = await handler(new Request('http://localhost'), seedContext())

    expect(res.status).toBe(500)
    expect(await res.json()).toMatchObject({
      code: 'MISSING_CONNECTION_STRING',
      hint: expect.stringContaining('withPostgresAdminClient'),
    })
  })

  it('runs the query as-is — no transaction, no claims, no role switch', async () => {
    const handler = withPostgresAdminClient(async (_req, ctx) => {
      await ctx.postgresAdmin.query`select * from notes`
      return Response.json({ ok: true })
    })

    await handler(new Request('http://localhost'), seedContext())

    // The whole point: exactly one statement reaches Postgres.
    expect(h.issued).toEqual(['select * from notes'])
    expect(h.issued).not.toContain('begin')
    expect(h.issued.some((s) => s.includes('set_config'))).toBe(false)
    expect(h.issued.some((s) => s.startsWith('set local role'))).toBe(false)
  })

  it('passes query parameters through', async () => {
    const handler = withPostgresAdminClient(async (_req, ctx) => {
      await ctx.postgresAdmin.queryRaw(
        'select * from notes where user_id = $1',
        ['u1'],
      )
      return Response.json({ ok: true })
    })

    await handler(new Request('http://localhost'), seedContext())

    expect(h.params[0]).toEqual(['u1'])
  })

  it('needs no upstream claims — composes with no jwtClaims on the context', async () => {
    // The scoped half requires ctx.jwtClaims; this one must not, so it can be
    // used under auth: 'secret' / 'none' where there is no caller identity.
    const handler = withPostgresAdminClient(async (_req, ctx) => {
      const rows = await ctx.postgresAdmin.query`select 1`
      return Response.json({ rows })
    })

    const res = await handler(new Request('http://localhost'), seedContext())

    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ rows: [{ ok: true }] })
  })

  it('shares the pool cache with the scoped middleware', async () => {
    // Same connection string as the scoped half would use: one pool, not two.
    const { withPostgresClient } = await import('../postgres/index.js')
    const before = h.pooled.length

    const admin = withPostgresAdminClient(
      { connectionString: 'postgres://localhost/shared' },
      async (_req, ctx) => {
        await ctx.postgresAdmin.query`select 1`
        return Response.json({ ok: true })
      },
    )
    await admin(new Request('http://localhost'), seedContext())

    const scoped = withPostgresClient(
      { connectionString: 'postgres://localhost/shared' },
      async () => Response.json({ ok: true }),
    )
    await scoped(new Request('http://localhost'), {
      ...seedContext(),
      jwtClaims: { role: 'authenticated' },
    })

    expect(h.pooled.slice(before)).toEqual(['postgres://localhost/shared'])
  })
})
