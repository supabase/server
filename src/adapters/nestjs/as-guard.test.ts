import { HttpException, type ExecutionContext } from '@nestjs/common'
import { describe, expect, it, vi } from 'vitest'

import { defineGate } from '../../core/gates/define-gate.js'
import type { SupabaseContext } from '../../types.js'

import { asGuard } from './as-guard.js'

interface MockReq {
  headers: Record<string, string | string[] | undefined>
  url?: string
  supabaseContext?: SupabaseContext
  gateContext?: Record<string, unknown>
}

function makeCtx(
  req: MockReq,
  type: 'http' | 'rpc' | 'ws' = 'http',
): ExecutionContext {
  return {
    getType: <T>() => type as T,
    switchToHttp: () => ({
      getRequest: <T>() => req as T,
      getResponse: <T>() => ({}) as T,
      getNext: <T>() => (() => undefined) as T,
    }),
  } as unknown as ExecutionContext
}

const passingGate = defineGate<
  'flag',
  { name: string },
  Record<never, never>,
  { name: string; admitted: true }
>({
  key: 'flag',
  run: (config) => async () => ({
    flag: { name: config.name, admitted: true as const },
  }),
})

const rejectingGate = defineGate<
  'blocker',
  { status: number },
  Record<never, never>,
  Record<never, never>
>({
  key: 'blocker',
  run: (config) => async () =>
    Response.json({ error: 'blocked' }, { status: config.status }),
})

describe('asGuard', () => {
  it('writes the gate contribution to req.gateContext on success', async () => {
    const Guard = asGuard(passingGate, { name: 'beta' })
    const guard = new Guard()
    const req: MockReq = { headers: {}, url: '/' }

    const result = await guard.canActivate(makeCtx(req))

    expect(result).toBe(true)
    expect(req.gateContext).toEqual({
      flag: { name: 'beta', admitted: true },
    })
  })

  it('merges into existing gateContext rather than replacing it', async () => {
    const Guard = asGuard(passingGate, { name: 'beta' })
    const guard = new Guard()
    const req: MockReq = {
      headers: {},
      url: '/',
      gateContext: { earlier: { left: 'alone' } },
    }

    await guard.canActivate(makeCtx(req))

    expect(req.gateContext).toEqual({
      earlier: { left: 'alone' },
      flag: { name: 'beta', admitted: true },
    })
  })

  it('does not touch req.supabaseContext when writing a contribution', async () => {
    const supabaseContext = { authMode: 'none' } as unknown as SupabaseContext
    const Guard = asGuard(passingGate, { name: 'beta' })
    const guard = new Guard()
    const req: MockReq = {
      headers: {},
      url: '/',
      supabaseContext,
    }

    await guard.canActivate(makeCtx(req))

    // supabaseContext is untouched — gates live in their own bag.
    expect(req.supabaseContext).toBe(supabaseContext)
    expect(
      (req.supabaseContext as Record<string, unknown>).flag,
    ).toBeUndefined()
  })

  it('throws HttpException with the gate response status on short-circuit', async () => {
    const Guard = asGuard(rejectingGate, { status: 429 })
    const guard = new Guard()
    const req: MockReq = { headers: {}, url: '/' }

    let caught: HttpException | null = null
    try {
      await guard.canActivate(makeCtx(req))
    } catch (e) {
      caught = e as HttpException
    }

    expect(caught).toBeInstanceOf(HttpException)
    expect(caught!.getStatus()).toBe(429)
    expect(caught!.getResponse()).toEqual({ error: 'blocked' })
  })

  it('falls back to text for non-JSON short-circuit bodies', async () => {
    const textGate = defineGate<
      'text',
      undefined,
      Record<never, never>,
      Record<never, never>
    >({
      key: 'text',
      run: () => async () =>
        new Response('go away', {
          status: 418,
          headers: { 'content-type': 'text/plain' },
        }),
    })

    const Guard = asGuard(textGate, undefined)
    const guard = new Guard()
    const req: MockReq = { headers: {}, url: '/' }

    let caught: HttpException | null = null
    try {
      await guard.canActivate(makeCtx(req))
    } catch (e) {
      caught = e as HttpException
    }

    expect(caught).toBeInstanceOf(HttpException)
    expect(caught!.getStatus()).toBe(418)
    expect(caught!.getResponse()).toBe('go away')
  })

  it('does not write a contribution when the gate short-circuits', async () => {
    const Guard = asGuard(rejectingGate, { status: 429 })
    const guard = new Guard()
    const req: MockReq = { headers: {}, url: '/' }

    await guard.canActivate(makeCtx(req)).catch(() => null)

    expect(req.gateContext).toBeUndefined()
  })

  it('builds upstream by merging supabaseContext + gateContext', async () => {
    // A gate that depends on prior gate contributions AND on Supabase fields.
    // Its `In` deliberately spans both bags so we can prove the merge happens.
    const reflectingGate = defineGate<
      'reflected',
      undefined,
      { supabase: unknown; flag: unknown },
      { supabaseSeen: boolean; flagSeen: boolean }
    >({
      key: 'reflected',
      run: () => async (_req, ctx) => ({
        reflected: {
          supabaseSeen: !!ctx.supabase,
          flagSeen: !!(ctx as { flag?: unknown }).flag,
        },
      }),
    })

    const Guard = asGuard(reflectingGate, undefined)
    const guard = new Guard()
    const req: MockReq = {
      headers: {},
      url: '/',
      supabaseContext: {
        supabase: 'fake-client',
      } as unknown as SupabaseContext,
      gateContext: { flag: { name: 'beta' } },
    }

    await guard.canActivate(makeCtx(req))

    expect(req.gateContext).toMatchObject({
      reflected: { supabaseSeen: true, flagSeen: true },
    })
  })

  it('passes a Web Request with copied headers to the gate', async () => {
    const inspector = vi.fn(async (req: Request) => ({
      inspect: { method: req.method, host: req.headers.get('host') },
    }))
    const inspectingGate = defineGate<
      'inspect',
      undefined,
      Record<never, never>,
      { method: string; host: string | null }
    >({
      key: 'inspect',
      run: () => inspector,
    })

    const Guard = asGuard(inspectingGate, undefined)
    const guard = new Guard()
    const req: MockReq = {
      headers: { host: 'api.test', authorization: 'Bearer abc' },
      url: '/things',
    }

    await guard.canActivate(makeCtx(req))

    expect(inspector).toHaveBeenCalledOnce()
    const [webReq] = inspector.mock.calls[0]!
    expect(webReq).toBeInstanceOf(Request)
    expect(webReq.headers.get('host')).toBe('api.test')
    expect(webReq.headers.get('authorization')).toBe('Bearer abc')
  })

  it('throws on non-HTTP execution contexts', async () => {
    const Guard = asGuard(passingGate, { name: 'beta' })
    const guard = new Guard()
    const req: MockReq = { headers: {}, url: '/' }

    for (const type of ['rpc', 'ws'] as const) {
      let caught: HttpException | null = null
      try {
        await guard.canActivate(makeCtx(req, type))
      } catch (e) {
        caught = e as HttpException
      }
      expect(caught).toBeInstanceOf(HttpException)
      expect(caught!.getStatus()).toBe(500)
      const body = caught!.getResponse() as { code: string; message: string }
      expect(body.code).toBe('unsupported_context')
      expect(body.message).toContain(type)
    }
  })
})
