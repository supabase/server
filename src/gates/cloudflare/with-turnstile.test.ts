import { afterEach, describe, expect, it, vi } from 'vitest'

import { chain } from '../../core/gates/index.js'
import { withTurnstile } from './with-turnstile.js'

const SITEVERIFY = 'https://verify.test/turnstile'

const baseConfig = {
  secretKey: 'sk_test',
  siteverifyUrl: SITEVERIFY,
}

const fetchMock = vi.fn()
vi.stubGlobal('fetch', fetchMock)

afterEach(() => {
  fetchMock.mockReset()
})

const okBody = {
  success: true,
  challenge_ts: '2026-01-01T00:00:00Z',
  hostname: 'app.example.com',
  action: 'login',
  cdata: 'abc',
}

const innerOk = async () => Response.json({ ok: true })

describe('withTurnstile', () => {
  it('rejects when no token is present', async () => {
    const handler = chain(withTurnstile(baseConfig))(innerOk)

    const res = await handler(new Request('http://localhost/'))

    expect(res.status).toBe(401)
    expect(await res.json()).toEqual({ error: 'turnstile_token_missing' })
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('passes when verification succeeds and contributes state', async () => {
    fetchMock.mockResolvedValueOnce(
      new Response(JSON.stringify(okBody), { status: 200 }),
    )

    const inner = vi.fn(async (_req: Request, ctx) => {
      expect(ctx.state.turnstile).toEqual({
        challengeTs: '2026-01-01T00:00:00Z',
        hostname: 'app.example.com',
        action: 'login',
        cdata: 'abc',
      })
      return Response.json({ ok: true })
    })

    const handler = chain(withTurnstile(baseConfig))(inner)

    const res = await handler(
      new Request('http://localhost/', {
        headers: { 'cf-turnstile-response': 'tok_abc' },
      }),
    )

    expect(res.status).toBe(200)
    expect(inner).toHaveBeenCalledOnce()
    expect(fetchMock).toHaveBeenCalledOnce()
    const [calledUrl, calledInit] = fetchMock.mock.calls[0]
    expect(calledUrl).toBe(SITEVERIFY)
    expect(calledInit.method).toBe('POST')
    const sent = calledInit.body as URLSearchParams
    expect(sent.get('secret')).toBe('sk_test')
    expect(sent.get('response')).toBe('tok_abc')
    expect(sent.get('remoteip')).toBeNull()
  })

  it('rejects when verification fails', async () => {
    fetchMock.mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          success: false,
          'error-codes': ['invalid-input-response'],
        }),
      ),
    )

    const handler = chain(withTurnstile(baseConfig))(innerOk)

    const res = await handler(
      new Request('http://localhost/', {
        headers: { 'cf-turnstile-response': 'tok_bad' },
      }),
    )

    expect(res.status).toBe(401)
    expect(await res.json()).toEqual({
      error: 'turnstile_verification_failed',
      codes: ['invalid-input-response'],
    })
  })

  it('rejects on action mismatch', async () => {
    fetchMock.mockResolvedValueOnce(
      new Response(JSON.stringify({ ...okBody, action: 'signup' })),
    )

    const handler = chain(
      withTurnstile({ ...baseConfig, expectedAction: 'login' }),
    )(innerOk)

    const res = await handler(
      new Request('http://localhost/', {
        headers: { 'cf-turnstile-response': 'tok' },
      }),
    )

    expect(res.status).toBe(401)
    expect(await res.json()).toMatchObject({
      error: 'turnstile_action_mismatch',
      expected: 'login',
      actual: 'signup',
    })
  })

  it('returns 503 when siteverify is unreachable', async () => {
    fetchMock.mockResolvedValueOnce(
      new Response('upstream error', { status: 502 }),
    )

    const handler = chain(withTurnstile(baseConfig))(innerOk)

    const res = await handler(
      new Request('http://localhost/', {
        headers: { 'cf-turnstile-response': 'tok' },
      }),
    )

    expect(res.status).toBe(503)
  })

  it('forwards remoteip when cf-connecting-ip is present', async () => {
    fetchMock.mockResolvedValueOnce(new Response(JSON.stringify(okBody)))

    const handler = chain(withTurnstile(baseConfig))(innerOk)

    await handler(
      new Request('http://localhost/', {
        headers: {
          'cf-turnstile-response': 'tok',
          'cf-connecting-ip': '1.2.3.4',
        },
      }),
    )

    const sent = fetchMock.mock.calls[0][1].body as URLSearchParams
    expect(sent.get('remoteip')).toBe('1.2.3.4')
  })

  it('honors a custom getToken extractor', async () => {
    fetchMock.mockResolvedValueOnce(new Response(JSON.stringify(okBody)))

    const handler = chain(
      withTurnstile({
        ...baseConfig,
        getToken: (req) => new URL(req.url).searchParams.get('captcha'),
      }),
    )(innerOk)

    const res = await handler(
      new Request('http://localhost/?captcha=tok_query'),
    )

    expect(res.status).toBe(200)
    const sent = fetchMock.mock.calls[0][1].body as URLSearchParams
    expect(sent.get('response')).toBe('tok_query')
  })
})
