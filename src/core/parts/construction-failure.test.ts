import { describe, expect, it } from 'vitest'

import {
  CreateSupabaseClientError,
  EnvError,
  ErrorCodeHeader,
  Errors,
} from '../../errors.js'
import {
  constructionFailureResponse,
  isConstructionFailure,
  markConstructionFailure,
} from './construction-failure.js'

describe('construction failure brand', () => {
  it('marks and recognizes an EnvError', () => {
    const error = markConstructionFailure(
      new EnvError('missing key', 'MISSING_DEFAULT_PUBLISHABLE_KEY'),
    )
    expect(isConstructionFailure(error)).toBe(true)
  })

  it('does not recognize an unmarked error of the same class', () => {
    expect(
      isConstructionFailure(new EnvError('handler-level env failure')),
    ).toBe(false)
    expect(isConstructionFailure(new Error('x'))).toBe(false)
  })

  it('leaves the error shape and JSON payload untouched', () => {
    const plain = new EnvError('missing key', 'MISSING_DEFAULT_PUBLISHABLE_KEY')
    const marked = markConstructionFailure(
      new EnvError('missing key', 'MISSING_DEFAULT_PUBLISHABLE_KEY'),
    )
    expect(Object.getOwnPropertyNames(marked)).toEqual(
      Object.getOwnPropertyNames(plain),
    )
    expect(JSON.stringify(marked)).toBe(JSON.stringify(plain))
  })

  it('renders an EnvError as a 500 that keeps its code and hint', async () => {
    const error = markConstructionFailure(
      new EnvError('missing key', 'MISSING_DEFAULT_PUBLISHABLE_KEY', {
        hint: 'set it',
      }),
    )
    const res = constructionFailureResponse(error)
    expect(res.status).toBe(500)
    expect(res.headers.get(ErrorCodeHeader)).toBe(
      'MISSING_DEFAULT_PUBLISHABLE_KEY',
    )
    const body = await res.json()
    expect(body.code).toBe('MISSING_DEFAULT_PUBLISHABLE_KEY')
    expect(body.hint).toBe('set it')
  })

  it('renders a CreateSupabaseClientError with its own status', async () => {
    const error = markConstructionFailure(
      Errors[CreateSupabaseClientError]({ cause: new Error('boom') }),
    )
    const res = constructionFailureResponse(error)
    expect(res.status).toBe(error.status)
    expect((await res.json()).code).toBe(CreateSupabaseClientError)
  })

  it('honors errors: { detailed: false }', async () => {
    const error = markConstructionFailure(
      new EnvError('missing key', 'MISSING_DEFAULT_PUBLISHABLE_KEY', {
        hint: 'set it',
      }),
    )
    const body = await constructionFailureResponse(error, {
      detailed: false,
    }).json()
    expect(body).toEqual({
      code: 'MISSING_DEFAULT_PUBLISHABLE_KEY',
      message: expect.any(String),
    })
  })
})
