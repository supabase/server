import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

// Shared mock state, hoisted so the vi.mock factory can close over it.
const h = vi.hoisted(() => {
  const issued: string[] = []
  const params: (unknown[] | undefined)[] = []
  const pooled: string[] = []
  // The full config of every Pool constructed, in the same order.
  const configs: Record<string, unknown>[] = []
  // Each statement checks a connection out and releases it; the admin path
  // wraps nothing around it.
  const clientQuery = vi.fn(async (text: string, p?: unknown[]) => {
    issued.push(text)
    params.push(p)
    return { rows: [{ ok: true }] }
  })
  const release = vi.fn()
  const connect = vi.fn(async () => ({ query: clientQuery, release }))
  return { issued, params, pooled, configs, clientQuery, release, connect }
})

vi.mock('pg', async () => {
  const { EventEmitter } = await import('node:events')
  // Real pg pools are EventEmitters; getPool attaches 'error' and 'connect'
  // listeners on construction, so the mock must accept them. `options.max`
  // sizes the wrapper's checkout slots and `idleCount` is what the
  // connect-failure backoff reads to decide whether a checkout would open a
  // new connection.
  class Pool extends EventEmitter {
    connect = h.connect
    idleCount = 0
    waitingCount = 0
    options: Record<string, unknown>
    constructor(config: { connectionString: string }) {
      super()
      this.options = config
      h.pooled.push(config.connectionString)
      h.configs.push(config)
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
    h.clientQuery.mockClear()
    h.release.mockClear()
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

  it('honors errors: { detailed: false } on its short-circuit', async () => {
    vi.stubEnv('SUPABASE_DB_URL', undefined)
    const handler = withPostgresAdminClient(
      { errors: { detailed: false } },
      async () => Response.json({ ok: true }),
    )

    const res = await handler(new Request('http://localhost'), seedContext())

    expect(res.status).toBe(500)
    expect(await res.json()).toEqual({
      code: 'MISSING_CONNECTION_STRING',
      message: expect.stringMatching(/^\[@supabase\/server\]/),
    })
  })

  it('takes the same pool options as the scoped middleware', async () => {
    const handler = withPostgresAdminClient(
      {
        connectionString: 'postgres://localhost/admin-tuned',
        pool: { max: 3 },
      },
      async (_req, ctx) => {
        await ctx.postgresAdmin.query`select 1`
        return Response.json({ ok: true })
      },
    )

    await handler(new Request('http://localhost'), seedContext())

    expect(h.configs.at(-1)).toMatchObject({
      connectionString: 'postgres://localhost/admin-tuned',
      max: 3,
      connectionTimeoutMillis: 10_000,
    })
  })

  it('refuses invalid pool options when the middleware is built', () => {
    expect(() =>
      withPostgresAdminClient({ pool: { max: 1.5 } }, async () =>
        Response.json({ ok: true }),
      ),
    ).toThrow(RangeError)
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
    // A clean release, so the connection goes back to the pool.
    expect(h.release).toHaveBeenCalledWith()
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
