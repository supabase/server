import { describe, expect, it, vi } from 'vitest'

import { withSupabase } from '../../with-supabase.js'
import { chain } from './chain.js'
import { defineGate } from './define-gate.js'
import type { Gate } from './types.js'

const baseEnv = {
  url: 'https://test.supabase.co',
  publishableKeys: { default: 'sb_publishable_xyz' },
  secretKeys: { default: 'sb_secret_xyz' },
  jwks: null,
}

const passingGate = <N extends string, C>(namespace: N, contribution: C) =>
  defineGate<N, undefined, Record<never, never>, C>({
    namespace: namespace as never,
    run: () => async () => ({ kind: 'pass', contribution }),
  })(undefined)

const rejectingGate = <N extends string>(namespace: N, status = 401) =>
  defineGate<N, undefined, Record<never, never>, Record<never, never>>({
    namespace: namespace as never,
    run: () => async () => ({
      kind: 'reject',
      response: new Response(`rejected by ${namespace}`, { status }),
    }),
  })(undefined)

describe('chain', () => {
  it('runs gates in order and passes contributions to ctx.state', async () => {
    const gateA = passingGate('alpha', { a: 1 })
    const gateB = passingGate('beta', { b: 2 })

    const handler = vi.fn(
      async (
        _req: Request,
        ctx: { state: { alpha: { a: number }; beta: { b: number } } },
      ) => {
        expect(ctx.state.alpha).toEqual({ a: 1 })
        expect(ctx.state.beta).toEqual({ b: 2 })
        return Response.json({ ok: true })
      },
    )

    const fetchHandler = chain(gateA, gateB)(handler)
    const res = await fetchHandler(new Request('http://localhost/'))

    expect(res.status).toBe(200)
    expect(handler).toHaveBeenCalledOnce()
  })

  it('short-circuits on the first rejecting gate without running downstream', async () => {
    const downstreamRun = vi.fn()
    const downstream: Gate<
      Record<never, never>,
      'downstream',
      Record<never, never>
    > = {
      namespace: 'downstream',
      run: async (...args) => {
        downstreamRun(...args)
        return { kind: 'pass', contribution: {} }
      },
    }

    const handler = vi.fn(async () => Response.json({ ok: true }))

    const fetchHandler = chain(
      rejectingGate('blocker', 402),
      downstream,
    )(handler)
    const res = await fetchHandler(new Request('http://localhost/'))

    expect(res.status).toBe(402)
    expect(await res.text()).toBe('rejected by blocker')
    expect(downstreamRun).not.toHaveBeenCalled()
    expect(handler).not.toHaveBeenCalled()
  })

  it('exposes a mutable ctx.locals to gates and the handler', async () => {
    const stamping: Gate<
      { locals: Record<string, unknown> },
      'stamping',
      { stamped: boolean }
    > = {
      namespace: 'stamping',
      run: async (_req, ctx) => {
        ctx.locals.stampedAt = 123
        return { kind: 'pass', contribution: { stamped: true } }
      },
    }

    const handler = vi.fn(
      async (
        _req: Request,
        ctx: {
          state: { stamping: { stamped: boolean } }
          locals: Record<string, unknown>
        },
      ) => {
        expect(ctx.locals.stampedAt).toBe(123)
        ctx.locals.handlerWrote = 'yep'
        return Response.json({ locals: ctx.locals })
      },
    )

    const fetchHandler = chain(stamping)(handler)
    const res = await fetchHandler(new Request('http://localhost/'))

    expect(res.status).toBe(200)
    const body = (await res.json()) as { locals: Record<string, unknown> }
    expect(body.locals).toEqual({ stampedAt: 123, handlerWrote: 'yep' })
  })

  it('isolates ctx.locals between requests', async () => {
    const fetchHandler = chain(passingGate('marker', { v: 1 }))(async (
      _req,
      ctx,
    ) => {
      const seen = ctx.locals.seen ?? false
      ctx.locals.seen = true
      return Response.json({ seen })
    })

    const r1 = await fetchHandler(new Request('http://localhost/'))
    const r2 = await fetchHandler(new Request('http://localhost/'))

    expect(await r1.json()).toEqual({ seen: false })
    expect(await r2.json()).toEqual({ seen: false })
  })

  it('merges baseCtx into the handler ctx when supplied', async () => {
    const handler = vi.fn(async (_req: Request, ctx) => {
      expect(ctx.tenantId).toBe('acme')
      expect(ctx.state.ping).toEqual({ pong: true })
      return Response.json({ ok: true })
    })

    const composed = chain(passingGate('ping', { pong: true as const }))<{
      tenantId: string
    }>(handler)
    const res = await composed(new Request('http://localhost/'), {
      tenantId: 'acme',
    })

    expect(res.status).toBe(200)
  })

  it('composes inside withSupabase, threading the SupabaseContext as baseCtx', async () => {
    const inner = vi.fn(async (_req: Request, ctx) => {
      // ctx has supabase fields (from withSupabase) AND state/locals (from chain)
      expect(ctx.authType).toBe('always')
      expect(ctx.state.ping).toEqual({ pong: true })
      expect(ctx.locals).toEqual({})
      return Response.json({ ok: true })
    })

    const fetchHandler = withSupabase(
      { allow: 'always', env: baseEnv, cors: false },
      chain(passingGate('ping', { pong: true as const }))(inner),
    )

    const res = await fetchHandler(new Request('http://localhost/'))
    expect(res.status).toBe(200)
    expect(inner).toHaveBeenCalledOnce()
  })

  it('runs with no gates and an empty state', async () => {
    const handler = vi.fn(
      async (
        _req: Request,
        ctx: {
          state: Record<never, never>
          locals: Record<string, unknown>
        },
      ) => {
        expect(ctx.state).toEqual({})
        expect(ctx.locals).toEqual({})
        return Response.json({ ok: true })
      },
    )

    const fetchHandler = chain()(handler)
    await fetchHandler(new Request('http://localhost/'))

    expect(handler).toHaveBeenCalledOnce()
  })
})

describe('defineGate', () => {
  it('produces a gate factory that closes over its config', async () => {
    const withGreeting = defineGate<
      'greeting',
      { who: string },
      Record<never, never>,
      { hello: string }
    >({
      namespace: 'greeting',
      run: (config) => async () => ({
        kind: 'pass',
        contribution: { hello: config.who },
      }),
    })

    const fetchHandler = chain(withGreeting({ who: 'world' }))(
      async (_req, ctx) => Response.json({ msg: ctx.state.greeting.hello }),
    )

    const res = await fetchHandler(new Request('http://localhost/'))
    expect(await res.json()).toEqual({ msg: 'world' })
  })

  it('rejects reserved namespace names at the type level', () => {
    // Type-level assertion: passing a reserved literal to defineGate fails
    // ValidNamespace's check, so the namespace property's expected type is
    // `never` and the literal can't be assigned. The @ts-expect-error
    // directives below document and lock in that intent.
    defineGate({
      // @ts-expect-error — 'state' is reserved
      namespace: 'state',
      run: () => async () => ({ kind: 'pass', contribution: {} }),
    })

    defineGate({
      // @ts-expect-error — 'supabase' is a host key; reserved
      namespace: 'supabase',
      run: () => async () => ({ kind: 'pass', contribution: {} }),
    })
  })
})
