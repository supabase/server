import { describe, expect, it } from 'vitest'

import { ErrorCodeHeader } from '../../errors.js'
import { withSupabaseCors } from './cors.js'

const ok = async () => Response.json({ ok: true })
const failing = async () =>
  Response.json(
    { code: 'X' },
    { status: 401, headers: { [ErrorCodeHeader]: 'X' } },
  )

describe('withSupabaseCors', () => {
  it('answers OPTIONS with 204 and the default headers', async () => {
    const res = await withSupabaseCors(
      { auth: 'none' },
      ok,
    )(new Request('http://localhost', { method: 'OPTIONS' }))
    expect(res.status).toBe(204)
    expect(res.headers.get('Access-Control-Allow-Origin')).toBe('*')
  })

  it('stamps CORS headers on a success response and exposes nothing extra', async () => {
    const res = await withSupabaseCors(
      { auth: 'none' },
      ok,
    )(new Request('http://localhost'))
    expect(res.headers.get('Access-Control-Allow-Origin')).toBe('*')
    expect(res.headers.get('Access-Control-Expose-Headers')).toBeNull()
  })

  it('exposes the error-code header on a response that carries it', async () => {
    const res = await withSupabaseCors(
      { auth: 'none' },
      failing,
    )(new Request('http://localhost'))
    expect(res.status).toBe(401)
    expect(res.headers.get('Access-Control-Allow-Origin')).toBe('*')
    expect(res.headers.get('Access-Control-Expose-Headers')).toBe(
      ErrorCodeHeader,
    )
  })

  it('appends to a configured Access-Control-Expose-Headers value', async () => {
    const res = await withSupabaseCors(
      {
        auth: 'none',
        cors: {
          headers: {
            'Access-Control-Allow-Origin': '*',
            'Access-Control-Expose-Headers': 'x-request-id',
          },
        },
      },
      failing,
    )(new Request('http://localhost'))
    expect(res.headers.get('Access-Control-Expose-Headers')).toBe(
      `x-request-id, ${ErrorCodeHeader}`,
    )
  })

  it("lets OPTIONS through and stamps nothing when cors is 'disabled'", async () => {
    const config = { auth: 'none', cors: 'disabled' } as const
    const preflight = await withSupabaseCors(
      config,
      ok,
    )(new Request('http://localhost', { method: 'OPTIONS' }))
    expect(preflight.status).toBe(200)

    const res = await withSupabaseCors(
      config,
      failing,
    )(new Request('http://localhost'))
    expect(res.headers.get('Access-Control-Allow-Origin')).toBeNull()
    expect(res.headers.get('Access-Control-Expose-Headers')).toBeNull()
    expect(res.headers.get(ErrorCodeHeader)).toBe('X')
  })

  it('propagates a thrown error untouched', async () => {
    const boom = async () => {
      throw new Error('handler failure')
    }
    await expect(
      withSupabaseCors({ auth: 'none' }, boom)(new Request('http://localhost')),
    ).rejects.toThrow('handler failure')
  })
})
