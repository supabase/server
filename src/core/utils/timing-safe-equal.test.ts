import { describe, expect, it } from 'vitest'

import { timingSafeEqual } from './timing-safe-equal.js'

describe('timingSafeEqual', () => {
  it('returns true for equal strings', async () => {
    expect(await timingSafeEqual('hello', 'hello')).toBe(true)
  })

  it('returns false for different strings', async () => {
    expect(await timingSafeEqual('hello', 'world')).toBe(false)
  })

  it('returns false for different length strings', async () => {
    expect(await timingSafeEqual('short', 'much longer string')).toBe(false)
  })

  it('returns true for both empty strings', async () => {
    expect(await timingSafeEqual('', '')).toBe(true)
  })
})
