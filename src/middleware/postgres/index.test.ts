import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

// Shared mock state, hoisted so the vi.mock factory can close over it.
const h = vi.hoisted(() => {
  const issued: string[] = []
  const params: (unknown[] | undefined)[] = []
  // Every connection string a Pool was constructed with, in order. The pool
  // cache lives at module scope, so this accumulates across the whole file.
  const pooled: string[] = []
  const clientQuery = vi.fn(async (text: string, p?: unknown[]) => {
    issued.push(text)
    params.push(p)
    return { rows: [{ ok: true }] }
  })
  const release = vi.fn()
  const connect = vi.fn(async () => ({ query: clientQuery, release }))
  return { issued, params, pooled, clientQuery, release, connect }
})

vi.mock('pg', () => {
  class Pool {
    connect = h.connect
    constructor(config: { connectionString: string }) {
      h.pooled.push(config.connectionString)
    }
  }
  return { default: { Pool }, Pool }
})

const { pipeline, seedContext } = await import('@supabase/middleware')
const { withClaims } = await import('../claims/index.js')
const { withPostgresClient } = await import('./index.js')

/**
 * Compile-time coverage for the `withClaims` prerequisite. Never called — the
 * assertions are `pnpm typecheck` failing, not vitest. Without an upstream
 * contributor for `jwtClaims`, `pipeline`'s `Validate` resolves the handler
 * parameter to a `middleware-prereq` sentinel string, so passing a function
 * there is an error.
 */
// eslint-disable-next-line @typescript-eslint/no-unused-vars
function _prerequisiteIsCompileTimeChecked() {
  pipeline([withClaims(), withPostgresClient()], async (_req, ctx) =>
    Response.json({ rows: await ctx.postgres.query('') }),
  )

  pipeline(
    [withPostgresClient()],
    // @ts-expect-error withPostgresClient requires an upstream `jwtClaims`
    async (_req, ctx) => Response.json({ rows: await ctx.postgres.query('') }),
  )

  // Ordering matters too: withClaims must run before withPostgresClient.
  pipeline(
    [withPostgresClient(), withClaims()],
    // @ts-expect-error `jwtClaims` is not on the context yet at this point
    async (_req, ctx) => Response.json({ rows: await ctx.postgres.query('') }),
  )
}

describe('withPostgresClient', () => {
  beforeEach(() => {
    h.issued.length = 0
    h.params.length = 0
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
    const handler = withPostgresClient(
      { connectionString: undefined },
      async () => Response.json({ ok: true }),
    )

    const res = await handler(new Request('http://localhost'), {
      ...seedContext(),
      jwtClaims: null,
    })

    expect(res.status).toBe(500)
    expect(await res.json()).toEqual({
      message: expect.stringContaining('SUPABASE_DB_URL'),
      code: 'ENV_ERROR',
    })
  })

  it('prefers config.connectionString over SUPABASE_DB_URL', async () => {
    const handler = withPostgresClient(
      { connectionString: 'postgres://localhost/from-config' },
      async (_req, ctx) => {
        await ctx.postgres.query('select 1')
        return Response.json({ ok: true })
      },
    )

    await handler(new Request('http://localhost'), {
      ...seedContext(),
      jwtClaims: { role: 'authenticated' },
    })

    expect(h.pooled).toContain('postgres://localhost/from-config')
    expect(h.pooled).not.toContain('postgres://localhost/test')
  })

  it('gives each connection string its own pool, and reuses it', async () => {
    const run = async (connectionString: string) => {
      const handler = withPostgresClient(
        { connectionString },
        async (_req, ctx) => {
          await ctx.postgres.query('select 1')
          return Response.json({ ok: true })
        },
      )
      await handler(new Request('http://localhost'), {
        ...seedContext(),
        jwtClaims: { role: 'authenticated' },
      })
    }

    const before = h.pooled.length
    await run('postgres://localhost/db-a')
    await run('postgres://localhost/db-b')
    // A repeat of db-a must hit the cache, not construct a third pool.
    await run('postgres://localhost/db-a')

    expect(h.pooled.slice(before)).toEqual([
      'postgres://localhost/db-a',
      'postgres://localhost/db-b',
    ])
  })

  it('falls back to anon with empty claims when there is no caller', async () => {
    const handler = withPostgresClient(async (_req, ctx) => {
      await ctx.postgres.query('select 1')
      return Response.json({ ok: true })
    })

    await handler(new Request('http://localhost'), {
      ...seedContext(),
      jwtClaims: null,
    })

    expect(h.issued).toContain('set local role anon')
    // The set_config parameter is the second query issued.
    expect(h.params[1]).toEqual(['{}'])
  })

  it('injects the caller claims and drops to the authenticated role', async () => {
    const handler = withPostgresClient(async (_req, ctx) => {
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
    const handler = withPostgresClient(async (_req, ctx) => {
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

    const handler = withPostgresClient(async (_req, ctx) => {
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

  it('surfaces the original error even when the rollback itself fails', async () => {
    // begin, set_config, set role succeed; the user query throws; and the
    // connection is broken enough that the rollback throws too.
    const ok = async (t: string) => {
      h.issued.push(t)
      return { rows: [] }
    }
    h.clientQuery
      .mockImplementationOnce(ok)
      .mockImplementationOnce(ok)
      .mockImplementationOnce(ok)
      .mockImplementationOnce(async () => {
        throw new Error('boom')
      })
      .mockImplementationOnce(async () => {
        throw new Error('connection terminated')
      })

    const handler = withPostgresClient(async (_req, ctx) => {
      await ctx.postgres.query('select bad')
      return Response.json({ ok: true })
    })

    await expect(
      handler(new Request('http://localhost'), {
        ...seedContext(),
        jwtClaims: { role: 'authenticated' },
      }),
      // 'boom' — not 'connection terminated'.
    ).rejects.toThrow('boom')

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

    const handler = withPostgresClient(async (_req, ctx) => {
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
