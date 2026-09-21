import { EventEmitter } from 'node:events'

import type { Pool, PoolClient } from 'pg'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { createConnectBackoff } from './postgres-backoff.js'
import { createPostgresPool, getPool } from './postgres-pool.js'

// Constructing a pg.Pool opens no connections, so the real Pool class is safe
// here — and it is the real class whose EventEmitter semantics matter: an
// 'error' emitted with zero listeners throws out of emit() and, from a live
// socket, takes down the whole process. Each test uses a distinct connection
// string because the pool cache is keyed by it and lives for the process.

describe('getPool', () => {
  it('survives an error from an idle pooled connection', () => {
    const { pool } = getPool('postgresql://pool-error@localhost:5432/db')
    expect(pool.listenerCount('error')).toBeGreaterThan(0)
    expect(() => pool.emit('error', new Error('backend died'))).not.toThrow()
  })

  it('survives an error from a checked-out client with no query in flight', () => {
    const { pool } = getPool('postgresql://client-error@localhost:5432/db')
    // pg emits 'connect' on the pool for every client it creates; the client
    // itself must end up with an 'error' listener, because a pool-level
    // listener does not cover a client that errors while checked out.
    const client = new EventEmitter()
    pool.emit('connect', client)
    expect(client.listenerCount('error')).toBeGreaterThan(0)
    expect(() => client.emit('error', new Error('backend died'))).not.toThrow()
  })

  it('returns the cached pool for a repeated connection string', () => {
    const url = 'postgresql://cached@localhost:5432/db'
    expect(getPool(url)).toBe(getPool(url))
  })

  it('caps the pool at four connections and the checkout wait at ten seconds', () => {
    const { pool } = getPool('postgresql://options@localhost:5432/db')
    const { options } = pool as unknown as {
      options: { max: number; connectionTimeoutMillis: number }
    }
    expect(options.max).toBe(4)
    expect(options.connectionTimeoutMillis).toBe(10_000)
  })
})

// The wrapper is tested against a stand-in pool: the real one would open a
// socket on connect(), and every behaviour under test is about what happens
// around that call, not inside it.
function fakePool() {
  const pool = new EventEmitter() as EventEmitter & {
    connect: ReturnType<typeof vi.fn>
    idleCount: number
    totalCount: number
  }
  pool.connect = vi.fn()
  pool.idleCount = 0
  pool.totalCount = 0
  return pool
}

function fakeClient(query: ReturnType<typeof vi.fn> = vi.fn()) {
  return { query, release: vi.fn() } as unknown as PoolClient & {
    query: ReturnType<typeof vi.fn>
    release: ReturnType<typeof vi.fn>
  }
}

function wrapped() {
  let now = 0
  const pool = fakePool()
  const backoff = createConnectBackoff({ now: () => now, random: () => 1 })
  const wrapper = createPostgresPool(pool as unknown as Pool, backoff)
  return {
    pool,
    wrapper,
    advance(ms: number) {
      now += ms
    },
  }
}

const authFailure = () => {
  const err = new Error('password authentication failed') as Error & {
    code: string
  }
  err.code = '28P01'
  return err
}

describe('createPostgresPool', () => {
  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('rethrows a connection failure and pauses new connection attempts', async () => {
    const log = vi.spyOn(console, 'error').mockImplementation(() => {})
    const { pool, wrapper } = wrapped()
    const failure = authFailure()
    pool.connect.mockRejectedValueOnce(failure)

    await expect(wrapper.connect()).rejects.toBe(failure)
    expect(log).toHaveBeenCalledTimes(1)
    expect(log.mock.calls[0][0]).toMatch(
      /pausing new connections for 1000ms: password authentication failed/,
    )

    const refused = wrapper.connect()
    await expect(refused).rejects.toThrow(
      /new connections paused for 1000ms after a connection failure: password authentication failed/,
    )
    await expect(refused).rejects.toHaveProperty('cause', failure)
    // The refusal is what keeps the pooler's circuit breaker from tripping:
    // the pool is never asked to try again inside the pause.
    expect(pool.connect).toHaveBeenCalledTimes(1)
  })

  it('lets a checkout that can reuse an idle connection through during a pause', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
    const { pool, wrapper } = wrapped()
    const client = fakeClient()
    pool.connect.mockRejectedValueOnce(authFailure())
    await expect(wrapper.connect()).rejects.toThrow()

    pool.idleCount = 1
    pool.connect.mockResolvedValueOnce(client)

    await expect(wrapper.connect()).resolves.toBe(client)
  })

  it('lets a checkout that will queue behind busy connections through during a pause', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
    const { pool, wrapper } = wrapped()
    const client = fakeClient()
    pool.connect.mockRejectedValueOnce(authFailure())
    await expect(wrapper.connect()).rejects.toThrow()

    // Every slot is taken and none is idle: pg-pool queues this checkout for a
    // release rather than opening a connection, so there is nothing to pause.
    pool.totalCount = 4
    pool.connect.mockResolvedValueOnce(client)

    await expect(wrapper.connect()).resolves.toBe(client)
  })

  it('attempts a new connection again once the pause has elapsed', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
    const { pool, wrapper, advance } = wrapped()
    const client = fakeClient()
    pool.connect.mockRejectedValueOnce(authFailure())
    await expect(wrapper.connect()).rejects.toThrow()

    advance(1000)
    pool.connect.mockResolvedValueOnce(client)

    await expect(wrapper.connect()).resolves.toBe(client)
    expect(pool.connect).toHaveBeenCalledTimes(2)
  })

  it('clears the pause when the pool reports a new connection', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
    const { pool, wrapper } = wrapped()
    const client = fakeClient()
    pool.connect.mockRejectedValueOnce(authFailure())
    await expect(wrapper.connect()).rejects.toThrow()

    // pg-pool emits 'connect' only for a physically new connection, so it is
    // the signal that the credentials or the network are good again.
    pool.emit('connect', client)
    pool.connect.mockResolvedValueOnce(client)

    await expect(wrapper.connect()).resolves.toBe(client)
  })

  it('annotates the checkout timeout without treating it as a connection failure', async () => {
    const log = vi.spyOn(console, 'error').mockImplementation(() => {})
    const { pool, wrapper } = wrapped()
    const client = fakeClient()
    pool.connect.mockRejectedValueOnce(
      new Error('timeout exceeded when trying to connect'),
    )

    await expect(wrapper.connect()).rejects.toThrow(
      /timeout exceeded when trying to connect \(all 4 pooled connections were busy for 10000ms\)/,
    )

    // Waiting out a busy pool says nothing about whether connecting works, so
    // the next checkout goes straight through.
    pool.connect.mockResolvedValueOnce(client)
    await expect(wrapper.connect()).resolves.toBe(client)
    expect(log).not.toHaveBeenCalled()
  })

  it('query checks a connection out, runs the statement, and releases it', async () => {
    const { pool, wrapper } = wrapped()
    const client = fakeClient(vi.fn(async () => ({ rows: [{ one: 1 }] })))
    pool.connect.mockResolvedValueOnce(client)

    const res = await wrapper.query('select $1::int as one', [1])

    expect(res.rows).toEqual([{ one: 1 }])
    expect(client.query).toHaveBeenCalledWith('select $1::int as one', [1])
    expect(client.release).toHaveBeenCalledWith()
  })

  it('query releases the connection with the error when the statement fails', async () => {
    const { pool, wrapper } = wrapped()
    const failure = new Error('relation "missing" does not exist')
    const client = fakeClient(vi.fn(async () => Promise.reject(failure)))
    pool.connect.mockResolvedValueOnce(client)

    await expect(wrapper.query('select * from missing')).rejects.toBe(failure)
    // Mirrors pg-pool's own query(): a truthy release argument discards the
    // connection instead of returning it to the pool.
    expect(client.release).toHaveBeenCalledWith(failure)
  })

  it('query is refused during a pause exactly like connect', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
    const { pool, wrapper } = wrapped()
    pool.connect.mockRejectedValueOnce(authFailure())
    await expect(wrapper.connect()).rejects.toThrow()

    await expect(wrapper.query('select 1')).rejects.toThrow(
      /new connections paused/,
    )
    expect(pool.connect).toHaveBeenCalledTimes(1)
  })
})
