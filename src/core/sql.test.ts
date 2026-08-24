import { describe, expect, it } from 'vitest'

import { compileTemplate, ident } from './sql.js'

/** Exercise the compiler through the tag shape callers actually use. */
const sql = (strings: TemplateStringsArray, ...values: unknown[]) =>
  compileTemplate(strings, values)

describe('ident', () => {
  it('wraps a plain name in double quotes', () => {
    expect(ident('users')).toBe('"users"')
  })

  it('doubles an embedded double quote', () => {
    expect(ident('we"ird')).toBe('"we""ird"')
  })

  it('neutralizes an injection attempt into a single quoted identifier', () => {
    expect(ident('x"; drop table t; --')).toBe('"x""; drop table t; --"')
  })

  it('preserves case rather than folding it', () => {
    expect(ident('MixedCase')).toBe('"MixedCase"')
  })

  it('rejects an empty name', () => {
    expect(() => ident('')).toThrow(/empty/i)
  })

  it('rejects a NUL byte, which Postgres cannot carry in an identifier', () => {
    expect(() => ident('a\0b')).toThrow(/NUL/i)
  })
})

describe('compileTemplate', () => {
  it('passes a template with no interpolation through unchanged', () => {
    expect(sql`select 1`).toEqual({ text: 'select 1', values: [] })
  })

  it('replaces a single interpolation with a $1 placeholder', () => {
    expect(sql`select * from notes where id = ${42}`).toEqual({
      text: 'select * from notes where id = $1',
      values: [42],
    })
  })

  it('numbers multiple placeholders left to right', () => {
    expect(sql`select * from n where a = ${'x'} and b = ${'y'}`).toEqual({
      text: 'select * from n where a = $1 and b = $2',
      values: ['x', 'y'],
    })
  })

  it('keeps adjacent interpolations as separate placeholders', () => {
    expect(sql`${'a'}${'b'}`).toEqual({ text: '$1$2', values: ['a', 'b'] })
  })

  it('handles an interpolation at the very start', () => {
    expect(sql`${1} = id`).toEqual({ text: '$1 = id', values: [1] })
  })

  it('does not deduplicate a value used twice', () => {
    expect(sql`${'v'} or ${'v'}`).toEqual({
      text: '$1 or $2',
      values: ['v', 'v'],
    })
  })

  it('passes null and undefined through as parameters, not as text', () => {
    expect(sql`a = ${null} and b = ${undefined}`).toEqual({
      text: 'a = $1 and b = $2',
      values: [null, undefined],
    })
  })

  it('never lets an interpolated string reach the SQL text', () => {
    const evil = "'; drop table notes; --"
    const { text, values } = sql`select * from notes where body = ${evil}`
    expect(text).toBe('select * from notes where body = $1')
    expect(text).not.toContain('drop table')
    expect(values).toEqual([evil])
  })
})
