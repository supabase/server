import { describe, expect, it } from 'vitest'

import { decodeKey, encodeKey, type Key } from './keys.js'

describe('encodeKey / decodeKey', () => {
  const cases: { name: string; key: Key }[] = [
    { name: 'empty', key: [] },
    { name: 'single string', key: ['users'] },
    { name: 'two strings', key: ['users', 'alice'] },
    { name: 'three strings', key: ['users', 'alice', 'profile'] },
    { name: 'numbers', key: [1, 2, 3] },
    { name: 'booleans', key: [true, false] },
    { name: 'bigints', key: [9999999999n, -1n] },
    { name: 'bytes', key: [new Uint8Array([0, 1, 255])] },
    { name: 'mixed types', key: ['mixed', 42, true, 7n] },
    { name: 'unicode', key: ['unicode 🌈 ñ é'] },
    {
      name: 'reserved characters',
      key: ['has/slash', 'has%percent', 'has\nnewline'],
    },
  ]

  it.each(cases)('roundtrips $name', ({ key }) => {
    expect(decodeKey(encodeKey(key))).toEqual([...key])
  })

  it('roundtrips an empty key', () => {
    expect(encodeKey([])).toBe('')
    expect(decodeKey('')).toEqual([])
  })

  it('makes shorter prefixes lexicographic prefixes of longer keys', () => {
    const short = encodeKey(['a'])
    const long = encodeKey(['a', 'b'])
    expect(long.startsWith(short)).toBe(true)
  })

  it('does not let a sibling with a longer first part look like a prefix', () => {
    const a = encodeKey(['a'])
    const ab = encodeKey(['ab'])
    expect(ab.startsWith(a)).toBe(false)
  })

  it('separates type tags so [1] and ["1"] do not collide', () => {
    expect(encodeKey([1])).not.toBe(encodeKey(['1']))
  })

  it('rejects non-finite numbers', () => {
    expect(() => encodeKey([NaN])).toThrow(/finite/)
    expect(() => encodeKey([Infinity])).toThrow(/finite/)
  })

  it('rejects unsupported types', () => {
    // @ts-expect-error — null is not a valid KeyPart
    expect(() => encodeKey([null])).toThrow()
    // @ts-expect-error — objects are not a valid KeyPart
    expect(() => encodeKey([{}])).toThrow()
  })

  it('produces a non-empty encoding even for falsy parts', () => {
    expect(encodeKey([0])).not.toBe('')
    expect(encodeKey([false])).not.toBe('')
    expect(encodeKey([''])).not.toBe('')
  })
})
