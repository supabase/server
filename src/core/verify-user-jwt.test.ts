import { errors } from 'jose'
import { describe, expect, it } from 'vitest'

import { describeClaimFailure } from './verify-user-jwt.js'

describe('describeClaimFailure', () => {
  it('reports a wrong-type claim as malformed before any per-claim wording', () => {
    const error = new errors.JWTClaimValidationFailed(
      '"aud" claim must be a string',
      {},
      'aud',
      'invalid',
    )
    const { reason, hint } = describeClaimFailure(error)
    expect(reason).toBe('its "aud" claim is malformed')
    expect(hint).not.toContain('"audience" option')
  })

  it('keeps the generic wording when jose names no claim', () => {
    const { reason } = describeClaimFailure(new Error('no claim on this one'))
    expect(reason).toBe('a registered claim failed validation')
  })
})
