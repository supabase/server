import { errors, exportJWK, generateKeyPair, SignJWT } from 'jose'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { describeClaimFailure, verifyUserJwt } from './verify-user-jwt.js'
import { resolveEnv } from './resolve-env.js'

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

describe('inline JWKS caching', () => {
  afterEach(() => {
    vi.restoreAllMocks()
    vi.unstubAllEnvs()
  })

  it('evicts old key sets when the local resolver cache reaches its bound', async () => {
    const { privateKey, publicKey } = await generateKeyPair('ES256')
    const key = await exportJWK(publicKey)
    const importKey = vi.spyOn(crypto.subtle, 'importKey')
    let firstToken = ''
    for (let index = 0; index < 17; index++) {
      const kid = `bounded-${index}`
      const token = await new SignJWT({ sub: 'user' })
        .setProtectedHeader({ alg: 'ES256', kid })
        .sign(privateKey)
      if (index === 0) firstToken = token
      expect(
        (await verifyUserJwt(token, { keys: [{ ...key, alg: 'ES256', kid }] }))
          .ok,
      ).toBe(true)
    }
    expect(importKey).toHaveBeenCalledTimes(17)
    expect(
      (
        await verifyUserJwt(firstToken, {
          keys: [{ ...key, alg: 'ES256', kid: 'bounded-0' }],
        })
      ).ok,
    ).toBe(true)
    expect(importKey).toHaveBeenCalledTimes(18)
  })

  it('reuses imported keys while accepting a replacement key set', async () => {
    const { privateKey, publicKey } = await generateKeyPair('ES256')
    const jwks = {
      keys: [{ ...(await exportJWK(publicKey)), alg: 'ES256', kid: 'test' }],
    }
    const token = await new SignJWT({ sub: 'user' })
      .setProtectedHeader({ alg: 'ES256', kid: 'test' })
      .sign(privateKey)
    const importKey = vi.spyOn(crypto.subtle, 'importKey')

    expect((await verifyUserJwt(token, jwks)).ok).toBe(true)
    expect(
      (await verifyUserJwt(token, JSON.parse(JSON.stringify(jwks)))).ok,
    ).toBe(true)
    expect(importKey).toHaveBeenCalledTimes(1)

    const rotated = await generateKeyPair('ES256')
    const replacement = {
      keys: [
        { ...(await exportJWK(rotated.publicKey)), alg: 'ES256', kid: 'test' },
      ],
    }
    expect((await verifyUserJwt(token, replacement)).ok).toBe(false)
    const rotatedToken = await new SignJWT({ sub: 'user' })
      .setProtectedHeader({ alg: 'ES256', kid: 'test' })
      .sign(rotated.privateKey)
    expect((await verifyUserJwt(rotatedToken, replacement)).ok).toBe(true)
    expect(importKey).toHaveBeenCalledTimes(2)
  })
})

describe('inline key-set updates', () => {
  it('observes in-place key rotation and revocation', async () => {
    const first = await generateKeyPair('ES256')
    const second = await generateKeyPair('ES256')
    const jwks = {
      keys: [
        { ...(await exportJWK(first.publicKey)), alg: 'ES256', kid: 'mutable' },
      ],
    }
    const token = await new SignJWT({ sub: 'user' })
      .setProtectedHeader({ alg: 'ES256', kid: 'mutable' })
      .sign(first.privateKey)
    expect((await verifyUserJwt(token, jwks)).ok).toBe(true)

    jwks.keys[0] = {
      ...(await exportJWK(second.publicKey)),
      alg: 'ES256',
      kid: 'mutable',
    }
    expect((await verifyUserJwt(token, jwks)).ok).toBe(false)
    const rotatedToken = await new SignJWT({ sub: 'user' })
      .setProtectedHeader({ alg: 'ES256', kid: 'mutable' })
      .sign(second.privateKey)
    expect((await verifyUserJwt(rotatedToken, jwks)).ok).toBe(true)
    jwks.keys = []
    expect((await verifyUserJwt(rotatedToken, jwks)).ok).toBe(false)
  })

  it('keeps cached symmetric sets independent of later source mutations', async () => {
    const secret = new Uint8Array(32).fill(1)
    const key = {
      kty: 'oct',
      alg: 'HS256',
      kid: 'symmetric',
      k: btoa(String.fromCharCode(...secret)),
    }
    const jwks = { keys: [key] }
    const token = await new SignJWT({ sub: 'user' })
      .setProtectedHeader({ alg: 'HS256', kid: 'symmetric' })
      .sign(secret)
    expect((await verifyUserJwt(token, jwks)).ok).toBe(true)
    jwks.keys = []
    expect((await verifyUserJwt(token, jwks)).ok).toBe(false)
    expect((await verifyUserJwt(token, { keys: [key] })).ok).toBe(true)
  })
})

describe('environment inline JWKS caching', () => {
  afterEach(() => {
    vi.restoreAllMocks()
    vi.unstubAllEnvs()
  })

  it('reuses imported keys across reparsed environment values and sees rotation', async () => {
    const { privateKey, publicKey } = await generateKeyPair('ES256')
    const keys = [
      { ...(await exportJWK(publicKey)), alg: 'ES256', kid: 'environment' },
    ]
    vi.stubEnv('SUPABASE_URL', 'https://test.supabase.co')
    vi.stubEnv('SUPABASE_JWKS', JSON.stringify(keys))
    const token = await new SignJWT({ sub: 'user' })
      .setProtectedHeader({ alg: 'ES256', kid: 'environment' })
      .sign(privateKey)
    const importKey = vi.spyOn(crypto.subtle, 'importKey')
    const first = resolveEnv().data!.jwks!
    const second = resolveEnv().data!.jwks!
    expect(first).not.toBe(second)
    expect((await verifyUserJwt(token, first)).ok).toBe(true)
    expect((await verifyUserJwt(token, second)).ok).toBe(true)
    expect(importKey).toHaveBeenCalledTimes(1)

    vi.stubEnv('SUPABASE_JWKS', '[]')
    expect((await verifyUserJwt(token, resolveEnv().data!.jwks!)).ok).toBe(
      false,
    )
  })
})
