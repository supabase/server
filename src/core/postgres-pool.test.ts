import { EventEmitter } from 'node:events'

import { describe, expect, it } from 'vitest'

import { getPool } from './postgres-pool.js'

// Constructing a pg.Pool opens no connections, so the real Pool class is safe
// here — and it is the real class whose EventEmitter semantics matter: an
// 'error' emitted with zero listeners throws out of emit() and, from a live
// socket, takes down the whole process. Each test uses a distinct connection
// string because the pool cache is keyed by it and lives for the process.

describe('getPool error hardening', () => {
  it('survives an error from an idle pooled connection', () => {
    const pool = getPool('postgresql://pool-error@localhost:5432/db')
    expect(pool.listenerCount('error')).toBeGreaterThan(0)
    expect(() => pool.emit('error', new Error('backend died'))).not.toThrow()
  })

  it('survives an error from a checked-out client with no query in flight', () => {
    const pool = getPool('postgresql://client-error@localhost:5432/db')
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
})
