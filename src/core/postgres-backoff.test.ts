import { describe, expect, it } from 'vitest'

import { createConnectBackoff } from './postgres-backoff.js'

// A controllable clock and random source, so every pause length is exact and
// no test waits on a real timer.
function fakeClock(random = 1) {
  let now = 0
  return {
    deps: { now: () => now, random: () => random },
    advance(ms: number) {
      now += ms
    },
  }
}

describe('createConnectBackoff', () => {
  it('starts with no pause', () => {
    const backoff = createConnectBackoff(fakeClock().deps)
    expect(backoff.remainingMs()).toBe(0)
  })

  it('pauses for the base delay after the first failure and counts it down', () => {
    const clock = fakeClock()
    const backoff = createConnectBackoff(clock.deps)

    expect(backoff.fail(new Error('auth failed'))).toBe(1000)
    expect(backoff.remainingMs()).toBe(1000)

    clock.advance(400)
    expect(backoff.remainingMs()).toBe(600)

    clock.advance(600)
    expect(backoff.remainingMs()).toBe(0)
  })

  it('jitters each pause between half and the full delay', () => {
    expect(createConnectBackoff(fakeClock(0).deps).fail(new Error())).toBe(500)
    expect(createConnectBackoff(fakeClock(0.5).deps).fail(new Error())).toBe(
      750,
    )
    expect(createConnectBackoff(fakeClock(1).deps).fail(new Error())).toBe(1000)
  })

  it('doubles the pause on each failing round and caps it at 30s', () => {
    const clock = fakeClock()
    const backoff = createConnectBackoff(clock.deps)
    const pauses: number[] = []

    for (let round = 0; round < 7; round++) {
      const pause = backoff.fail(new Error('still failing'))
      pauses.push(pause)
      clock.advance(pause)
    }

    expect(pauses).toEqual([1000, 2000, 4000, 8000, 16000, 30000, 30000])
  })

  it('does not escalate for failures that land during an active pause', () => {
    // Four pooled connections failing in parallel are one failing round, not
    // four: the pause must grow once per round.
    const clock = fakeClock()
    const backoff = createConnectBackoff(clock.deps)

    expect(backoff.fail(new Error('first'))).toBe(1000)
    expect(backoff.fail(new Error('parallel'))).toBe(0)
    expect(backoff.fail(new Error('parallel'))).toBe(0)
    expect(backoff.remainingMs()).toBe(1000)

    clock.advance(1000)
    expect(backoff.fail(new Error('next round'))).toBe(2000)
  })

  it('resets to the base delay after a successful connection', () => {
    const clock = fakeClock()
    const backoff = createConnectBackoff(clock.deps)

    backoff.fail(new Error('one'))
    clock.advance(1000)
    expect(backoff.fail(new Error('two'))).toBe(2000)

    backoff.succeed()
    expect(backoff.remainingMs()).toBe(0)

    clock.advance(5000)
    expect(backoff.fail(new Error('again'))).toBe(1000)
  })

  it('remembers the most recent failure until a connection succeeds', () => {
    const backoff = createConnectBackoff(fakeClock().deps)
    const first = new Error('first')
    const second = new Error('second')

    expect(backoff.lastError()).toBeUndefined()

    backoff.fail(first)
    expect(backoff.lastError()).toBe(first)

    // Still inside the pause — no escalation, but the newest cause wins.
    backoff.fail(second)
    expect(backoff.lastError()).toBe(second)

    backoff.succeed()
    expect(backoff.lastError()).toBeUndefined()
  })
})
