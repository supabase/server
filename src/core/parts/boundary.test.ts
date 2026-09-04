import { describe, expect, it } from 'vitest'

import { EnvError, ErrorCodeHeader } from '../../errors.js'
import { withConstructionBoundary } from './boundary.js'
import { markConstructionFailure } from './construction-failure.js'

const branded = (hint?: string) => async () => {
  throw markConstructionFailure(
    new EnvError('missing key', 'MISSING_DEFAULT_PUBLISHABLE_KEY', { hint }),
  )
}

describe('withConstructionBoundary', () => {
  it('maps a branded construction failure to a 500 JSON response', async () => {
    const res = await withConstructionBoundary(
      { auth: 'none' },
      branded(),
    )(new Request('http://localhost'))
    expect(res.status).toBe(500)
    expect(res.headers.get(ErrorCodeHeader)).toBe(
      'MISSING_DEFAULT_PUBLISHABLE_KEY',
    )
    expect((await res.json()).code).toBe('MISSING_DEFAULT_PUBLISHABLE_KEY')
  })

  it('lets an unbranded EnvError propagate', async () => {
    const throwing = async () => {
      throw new EnvError('handler-level env failure')
    }
    await expect(
      withConstructionBoundary(
        { auth: 'none' },
        throwing,
      )(new Request('http://localhost')),
    ).rejects.toThrow('handler-level env failure')
  })

  it('passes a normal response through unchanged', async () => {
    const res = await withConstructionBoundary(
      { auth: 'none' },
      async () => new Response('ok', { status: 201 }),
    )(new Request('http://localhost'))
    expect(res.status).toBe(201)
    expect(await res.text()).toBe('ok')
  })

  it('honors errors: { detailed: false }', async () => {
    const res = await withConstructionBoundary(
      { auth: 'none', errors: { detailed: false } },
      branded('set it'),
    )(new Request('http://localhost'))
    expect((await res.json()).hint).toBeUndefined()
  })
})
