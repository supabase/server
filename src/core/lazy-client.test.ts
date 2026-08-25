import { describe, expect, it } from 'vitest'

import { lazyClient } from './lazy-client.js'

class Thing {
  #secret = 42
  label = 'thing'

  reveal(): number {
    return this.#secret
  }

  get computed(): number {
    return this.#secret + 1
  }
}

function counted(): { proxy: Thing; calls: () => number; last: () => Thing } {
  let calls = 0
  let instance: Thing | undefined
  const proxy = lazyClient<Thing>(() => {
    calls++
    instance = new Thing()
    return instance
  })
  return { proxy, calls: () => calls, last: () => instance! }
}

describe('lazyClient', () => {
  it('defers construction until the first property access', () => {
    const { proxy, calls } = counted()
    expect(calls()).toBe(0)
    expect(proxy.label).toBe('thing')
    expect(calls()).toBe(1)
  })

  it('constructs at most once across traps', () => {
    const { proxy, calls } = counted()
    expect(proxy.label).toBe('thing')
    expect('reveal' in proxy).toBe(true)
    expect(Object.keys(proxy)).toContain('label')
    expect(proxy instanceof Thing).toBe(true)
    expect(calls()).toBe(1)
  })

  it('binds methods so private fields resolve against the instance', () => {
    const { proxy } = counted()
    const reveal = proxy.reveal
    expect(reveal()).toBe(42)
  })

  it('runs prototype getters against the instance', () => {
    const { proxy } = counted()
    expect(proxy.computed).toBe(43)
  })

  it('surfaces a factory throw at the access point and retries', () => {
    let calls = 0
    const proxy = lazyClient<Thing>(() => {
      calls++
      throw new Error(`boom ${calls}`)
    })
    expect(() => proxy.label).toThrow('boom 1')
    expect(() => proxy.label).toThrow('boom 2')
    expect(calls).toBe(2)
  })

  it('forwards writes to the underlying instance', () => {
    const { proxy, last } = counted()
    proxy.label = 'renamed'
    expect(last().label).toBe('renamed')
    expect(proxy.label).toBe('renamed')
  })

  it('spreads the instance own keys', () => {
    const { proxy } = counted()
    expect({ ...proxy }).toEqual({ label: 'thing' })
  })
})
