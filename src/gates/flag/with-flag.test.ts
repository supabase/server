import { describe, expect, it, vi } from 'vitest'

import { chain } from '../../core/gates/index.js'
import { withFlag } from './with-flag.js'

const innerOk = async () => Response.json({ ok: true })

describe('withFlag', () => {
  it('admits when evaluate returns true and contributes the flag state', async () => {
    const inner = vi.fn(async (_req: Request, ctx) => {
      expect(ctx.state.flag).toEqual({
        name: 'beta',
        enabled: true,
        variant: null,
        payload: null,
      })
      return Response.json({ ok: true })
    })

    const handler = chain(
      withFlag({
        name: 'beta',
        evaluate: () => true,
      }),
    )(inner)

    const res = await handler(new Request('http://localhost/'))
    expect(res.status).toBe(200)
    expect(inner).toHaveBeenCalledOnce()
  })

  it('rejects with 404 by default when evaluate returns false', async () => {
    const handler = chain(withFlag({ name: 'beta', evaluate: () => false }))(
      innerOk,
    )

    const res = await handler(new Request('http://localhost/'))
    expect(res.status).toBe(404)
    expect(await res.json()).toEqual({
      error: 'feature_disabled',
      flag: 'beta',
    })
  })

  it('honors a custom rejectStatus and rejectBody', async () => {
    const handler = chain(
      withFlag({
        name: 'beta',
        evaluate: () => false,
        rejectStatus: 403,
        rejectBody: { code: 'NOT_ROLLED_OUT' },
      }),
    )(innerOk)

    const res = await handler(new Request('http://localhost/'))
    expect(res.status).toBe(403)
    expect(await res.json()).toEqual({ code: 'NOT_ROLLED_OUT' })
  })

  it('captures variant + payload when evaluate returns a verdict object', async () => {
    const inner = vi.fn(async (_req: Request, ctx) => {
      expect(ctx.state.flag.variant).toBe('green')
      expect(ctx.state.flag.payload).toEqual({ rollout: 0.25 })
      return Response.json({ ok: true })
    })

    const handler = chain(
      withFlag({
        name: 'beta',
        evaluate: () => ({
          enabled: true,
          variant: 'green',
          payload: { rollout: 0.25 },
        }),
      }),
    )(inner)

    await handler(new Request('http://localhost/'))
    expect(inner).toHaveBeenCalledOnce()
  })

  it('passes the request to evaluate so flags can target by header / IP / user', async () => {
    const evaluate = vi.fn((req: Request) => req.headers.get('x-beta') === '1')

    const handler = chain(withFlag({ name: 'beta', evaluate }))(innerOk)

    const off = await handler(new Request('http://localhost/'))
    expect(off.status).toBe(404)

    const on = await handler(
      new Request('http://localhost/', { headers: { 'x-beta': '1' } }),
    )
    expect(on.status).toBe(200)

    expect(evaluate).toHaveBeenCalledTimes(2)
  })

  it('supports async evaluators', async () => {
    const handler = chain(
      withFlag({
        name: 'beta',
        evaluate: async () => {
          await new Promise((r) => setTimeout(r, 1))
          return { enabled: true, variant: 'a' }
        },
      }),
    )(async (_req, ctx) => Response.json({ variant: ctx.state.flag.variant }))

    const res = await handler(new Request('http://localhost/'))
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ variant: 'a' })
  })
})
