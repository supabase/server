import { EventEmitter } from 'node:events'

import pg from 'pg'
import type { Pool, PoolClient } from 'pg'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { createConnectBackoff } from './postgres-backoff.js'
import {
  CHECKOUT_TIMEOUT_MS,
  createPostgresPool,
  getPool,
} from './postgres-pool.js'

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

  it('caps the pool at four connections and the connect wait at ten seconds', () => {
    const { pool } = getPool('postgresql://options@localhost:5432/db')
    expect(pool.options.max).toBe(4)
    expect(pool.options.connectionTimeoutMillis).toBe(10_000)
  })
})

// The wrapper is tested against a stand-in pool: the real one would open a
// socket on connect(), and every behaviour under test is about what happens
// around that call, not inside it.
function fakePool(max = 4) {
  const pool = new EventEmitter() as EventEmitter & {
    connect: ReturnType<typeof vi.fn>
    idleCount: number
    options: { max: number }
  }
  pool.connect = vi.fn()
  pool.idleCount = 0
  pool.options = { max }
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

// Let every queued microtask run without touching timers.
const flush = () => new Promise<void>((r) => setImmediate(r))

describe('createPostgresPool', () => {
  afterEach(() => {
    vi.useRealTimers()
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

  it('lets a checkout reuse an idle connection during a pause', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
    const { pool, wrapper } = wrapped()
    pool.connect.mockRejectedValueOnce(authFailure())
    await expect(wrapper.connect()).rejects.toThrow()

    pool.idleCount = 1
    pool.connect.mockResolvedValueOnce(fakeClient())

    await expect(wrapper.connect()).resolves.toBeDefined()
    expect(pool.connect).toHaveBeenCalledTimes(2)
  })

  it('attempts a new connection again once the pause has elapsed', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
    const { pool, wrapper, advance } = wrapped()
    pool.connect.mockRejectedValueOnce(authFailure())
    await expect(wrapper.connect()).rejects.toThrow()

    advance(1000)
    pool.connect.mockResolvedValueOnce(fakeClient())

    await expect(wrapper.connect()).resolves.toBeDefined()
    expect(pool.connect).toHaveBeenCalledTimes(2)
  })

  it('clears the pause when the pool reports a new connection', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
    const { pool, wrapper } = wrapped()
    pool.connect.mockRejectedValueOnce(authFailure())
    await expect(wrapper.connect()).rejects.toThrow()

    // pg-pool emits 'connect' only for a physically new connection, so it is
    // the signal that the credentials or the network are good again.
    pool.emit('connect', fakeClient())
    pool.connect.mockResolvedValueOnce(fakeClient())

    await expect(wrapper.connect()).resolves.toBeDefined()
  })

  it('holds a checkout while every connection is out and hands one over on release', async () => {
    const { pool, wrapper } = wrapped()
    pool.connect.mockImplementation(async () => fakeClient())
    const held = await Promise.all([
      wrapper.connect(),
      wrapper.connect(),
      wrapper.connect(),
      wrapper.connect(),
    ])

    let settled = false
    const fifth = wrapper.connect().then((client) => {
      settled = true
      return client
    })
    await flush()
    // pg-pool never sees the fifth checkout: the wrapper owns the wait, so
    // pg-pool's own queue stays empty and cannot fan a failure out.
    expect(settled).toBe(false)
    expect(pool.connect).toHaveBeenCalledTimes(4)

    held[0].release()
    await expect(fifth).resolves.toBeDefined()
    expect(pool.connect).toHaveBeenCalledTimes(5)
  })

  it('fails a checkout that waits longer than the checkout timeout', async () => {
    vi.useFakeTimers()
    const { pool, wrapper } = wrapped()
    pool.connect.mockImplementation(async () => fakeClient())
    const held = await Promise.all([
      wrapper.connect(),
      wrapper.connect(),
      wrapper.connect(),
      wrapper.connect(),
    ])

    const waiting = wrapper.connect()
    const rejection = expect(waiting).rejects.toThrow(
      /all 4 connections stayed busy for 10000ms/,
    )
    await vi.advanceTimersByTimeAsync(CHECKOUT_TIMEOUT_MS)
    await rejection

    // A timed-out waiter is gone: the next release wakes nobody and the
    // connection simply goes back to the pool.
    held[0].release()
    await vi.advanceTimersByTimeAsync(0)
    expect(pool.connect).toHaveBeenCalledTimes(4)
  })

  it('refuses a woken waiter during a pause when no idle connection is left', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
    const { pool, wrapper } = wrapped()
    pool.connect.mockRejectedValueOnce(authFailure())
    await expect(wrapper.connect()).rejects.toThrow()

    // Fill every slot through the idle path, which the pause allows.
    pool.idleCount = 4
    pool.connect.mockImplementation(async () => fakeClient())
    const held = await Promise.all([
      wrapper.connect(),
      wrapper.connect(),
      wrapper.connect(),
      wrapper.connect(),
    ])
    pool.idleCount = 0

    const waiting = wrapper.connect()
    await flush()
    // The connection is discarded, not returned: the waiter would have to
    // open a new one, and that is exactly what the pause forbids.
    held[0].release(new Error('dead'))

    await expect(waiting).rejects.toThrow(/new connections paused/)
    expect(pool.connect).toHaveBeenCalledTimes(5)
  })

  it('lets a woken waiter reuse the connection that was just returned during a pause', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
    const { pool, wrapper } = wrapped()
    pool.connect.mockRejectedValueOnce(authFailure())
    await expect(wrapper.connect()).rejects.toThrow()

    pool.idleCount = 4
    pool.connect.mockImplementation(async () => fakeClient())
    const held = await Promise.all([
      wrapper.connect(),
      wrapper.connect(),
      wrapper.connect(),
      wrapper.connect(),
    ])
    pool.idleCount = 0

    const waiting = wrapper.connect()
    await flush()
    pool.idleCount = 1
    held[0].release()

    await expect(waiting).resolves.toBeDefined()
    expect(pool.connect).toHaveBeenCalledTimes(6)
  })

  it('refuses the second of two same-tick checkouts when one idle connection is spare during a pause', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
    const { pool, wrapper } = wrapped()
    pool.connect.mockRejectedValueOnce(authFailure())
    await expect(wrapper.connect()).rejects.toThrow()

    pool.idleCount = 1
    pool.connect.mockImplementation(async () => fakeClient())
    const first = wrapper.connect()
    const second = wrapper.connect()

    await expect(first).resolves.toBeDefined()
    // pg-pool would serve the first from the idle client and open a new
    // connection for the second; only the first may go through.
    await expect(second).rejects.toThrow(/new connections paused/)
    expect(pool.connect).toHaveBeenCalledTimes(2)
  })

  it('frees the slot when the pool rejects the checkout', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
    const { pool, wrapper, advance } = wrapped()
    pool.connect.mockRejectedValue(authFailure())
    await Promise.all(
      Array.from({ length: 4 }, () =>
        expect(wrapper.connect()).rejects.toThrow(),
      ),
    )

    advance(1000)
    pool.connect.mockImplementation(async () => fakeClient())
    const held = await Promise.all(
      Array.from({ length: 4 }, () => wrapper.connect()),
    )

    expect(held).toHaveLength(4)
    expect(pool.connect).toHaveBeenCalledTimes(8)
  })

  it('frees the slot once even if release is called twice', async () => {
    const { pool, wrapper } = wrapped()
    pool.connect.mockImplementation(async () => fakeClient())
    const held = await Promise.all([
      wrapper.connect(),
      wrapper.connect(),
      wrapper.connect(),
      wrapper.connect(),
    ])

    held[0].release()
    held[0].release()

    const fifth = wrapper.connect()
    const sixth = wrapper.connect()
    await expect(fifth).resolves.toBeDefined()
    await flush()
    // One slot came back, not two: the sixth still waits.
    expect(pool.connect).toHaveBeenCalledTimes(5)
    held[1].release()
    await expect(sixth).resolves.toBeDefined()
  })

  it('returns the slot even when the underlying release throws', async () => {
    const { pool, wrapper } = wrapped()
    const broken = fakeClient()
    broken.release.mockImplementationOnce(() => {
      throw new Error('release exploded')
    })
    pool.connect.mockResolvedValueOnce(broken)
    pool.connect.mockImplementation(async () => fakeClient())
    const held = await Promise.all([
      wrapper.connect(),
      wrapper.connect(),
      wrapper.connect(),
      wrapper.connect(),
    ])

    expect(() => held[0].release()).toThrow('release exploded')

    // The slot is not tied to pg-pool accepting the release: a fifth checkout
    // goes straight through instead of waiting on a slot lost for good.
    let settled = false
    const fifth = wrapper.connect().then((client) => {
      settled = true
      return client
    })
    await flush()
    expect(settled).toBe(true)
    await fifth
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

// pg-pool accepts a Client class, so a stub runs its real queue, timers, and
// events with no socket. This is the only way to see what a burst does: a
// vi.fn() stand-in cannot reproduce pg-pool handing the next queued checkout
// a fresh connection attempt the moment one fails.
describe('createPostgresPool against pg-pool', () => {
  afterEach(() => {
    vi.restoreAllMocks()
  })

  function realPool(Client: unknown, connectionTimeoutMillis = 10_000) {
    const pool = new pg.Pool({
      connectionString: 'postgresql://stub@localhost:5432/db',
      max: 4,
      connectionTimeoutMillis,
      Client,
    } as pg.PoolConfig)
    return createPostgresPool(
      pool,
      createConnectBackoff({ now: Date.now, random: () => 1 }),
    )
  }

  async function burst(
    wrapper: ReturnType<typeof createPostgresPool>,
    size: number,
  ) {
    let refused = 0
    let failed = 0
    await Promise.all(
      Array.from({ length: size }, () =>
        wrapper.connect().then(
          (client) => client.release(),
          (e: Error) => {
            if (/new connections paused/.test(e.message)) refused += 1
            else failed += 1
          },
        ),
      ),
    )
    return { refused, failed }
  }

  it('caps a cold burst at the pool size when connections fail', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
    let attempts = 0
    class FailingClient extends EventEmitter {
      connection = undefined
      connect(cb: (err?: Error) => void) {
        attempts += 1
        setTimeout(() => cb(new Error('password authentication failed')), 5)
      }
      end(cb?: () => void) {
        cb?.()
      }
      isConnected() {
        return false
      }
    }
    const wrapper = realPool(FailingClient)

    const first = await burst(wrapper, 50)
    // Four slots, four attempts. Every other checkout waited on the wrapper,
    // woke into the pause, and was refused without reaching the pooler.
    expect(attempts).toBe(4)
    expect(first).toEqual({ refused: 46, failed: 4 })

    const second = await burst(wrapper, 20)
    expect(attempts).toBe(4)
    expect(second).toEqual({ refused: 20, failed: 0 })
  })

  it('treats a connect that hits the pool timeout as a connection failure', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
    class HangingClient extends EventEmitter {
      connection = undefined
      private pending?: (err: Error) => void
      connect(cb: (err?: Error) => void) {
        this.pending = cb
      }
      // pg-pool ends a client whose connect outlives connectionTimeoutMillis;
      // the real driver then fails the pending connect.
      end(cb?: () => void) {
        this.pending?.(new Error('Connection terminated'))
        cb?.()
      }
      isConnected() {
        return false
      }
    }
    const wrapper = realPool(HangingClient, 20)

    await expect(wrapper.connect()).rejects.toThrow(
      /Connection terminated due to connection timeout/,
    )
    await expect(wrapper.connect()).rejects.toThrow(/new connections paused/)
  })
})
