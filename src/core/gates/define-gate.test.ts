import { describe, expect, it, vi } from 'vitest'

import { defineGate } from './define-gate.js'

const innerOk = async () => Response.json({ ok: true })

const passingGate = <Key extends string, C>(key: Key, contribution: C) =>
  defineGate<Key, undefined, Record<never, never>, C>({
    key,
    run: () => async () => ({ kind: 'pass', contribution }),
  })

const rejectingGate = <Key extends string>(key: Key, status = 401) =>
  defineGate<Key, undefined, Record<never, never>, Record<never, never>>({
    key,
    run: () => async () => ({
      kind: 'reject',
      response: new Response(`rejected by ${key}`, { status }),
    }),
  })

describe('defineGate', () => {
  it('runs the gate, contributes its key to ctx, and calls the inner handler', async () => {
    const withGreeting = defineGate<
      'greeting',
      { who: string },
      Record<never, never>,
      { hello: string }
    >({
      key: 'greeting',
      run: (config) => async () => ({
        kind: 'pass',
        contribution: { hello: config.who },
      }),
    })

    const fetchHandler = withGreeting({ who: 'world' }, async (_req, ctx) =>
      Response.json({ msg: ctx.greeting.hello }),
    )

    const res = await fetchHandler(new Request('http://localhost/'))
    expect(await res.json()).toEqual({ msg: 'world' })
  })

  it('short-circuits on reject without calling the inner handler', async () => {
    const inner = vi.fn(innerOk)
    const fetchHandler = rejectingGate('blocker', 402)(undefined, inner)

    const res = await fetchHandler(new Request('http://localhost/'))
    expect(res.status).toBe(402)
    expect(await res.text()).toBe('rejected by blocker')
    expect(inner).not.toHaveBeenCalled()
  })

  it('nests gates: outer contributes, inner sees the merged ctx', async () => {
    const withA = passingGate('alpha', { v: 1 })
    const withB = passingGate('beta', { v: 2 })

    const fetchHandler = withA(
      undefined,
      withB<{ alpha: { v: number } }>(undefined, async (_req, ctx) =>
        Response.json({ a: ctx.alpha.v, b: ctx.beta.v }),
      ),
    )

    const res = await fetchHandler(new Request('http://localhost/'))
    expect(await res.json()).toEqual({ a: 1, b: 2 })
  })

  it('refuses to compose where the gate would shadow an upstream key', () => {
    const withFoo = passingGate('foo', { v: 1 })

    // Calling the gate with a Base that already includes 'foo' returns a
    // `Conflict<'foo'>` sentinel string instead of a fetch handler. The error
    // surfaces when the result is used in a function position.
    const conflicted = withFoo<{ foo: { v: number } }>(undefined, async () =>
      Response.json({ ok: true }),
    )

    // @ts-expect-error — Conflict<Key> string is not assignable to a fetch handler
    const _fn: (req: Request) => Promise<Response> = conflicted
    void _fn
  })

  it('enforces prerequisites: gates with `In` keys require the upstream to provide them', async () => {
    interface Upstream {
      supabase: { from: (t: string) => { ok: boolean } }
      userClaims: { id: string }
    }

    const withReportAccess = defineGate<
      'reportAccess',
      { reportId: string },
      Upstream,
      { allowed: boolean }
    >({
      key: 'reportAccess',
      run: (config) => async (_req, ctx) => {
        // ctx is typed as Upstream — `from` is callable here
        const probe = ctx.supabase.from(`reports:${config.reportId}`)
        return {
          kind: 'pass',
          contribution: { allowed: probe.ok && ctx.userClaims.id !== '' },
        }
      },
    })

    // Compose with an outer wrapper that provides Upstream:
    const fakeUpstream: Upstream = {
      supabase: { from: () => ({ ok: true }) },
      userClaims: { id: 'u1' },
    }

    const fetchHandler = withReportAccess(
      { reportId: 'r1' },
      async (_req, ctx) =>
        Response.json({
          allowed: ctx.reportAccess.allowed,
          user: ctx.userClaims.id,
        }),
    )

    // baseCtx is REQUIRED for gates with prereqs — verifies the type.
    const res = await fetchHandler(
      new Request('http://localhost/'),
      fakeUpstream,
    )
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ allowed: true, user: 'u1' })
  })

  it('reject with prereqs short-circuits before contributing', async () => {
    interface Upstream {
      tenantId: string
    }

    const withTenantOnly = defineGate<
      'tenant',
      { allowed: string[] },
      Upstream,
      { tenantId: string }
    >({
      key: 'tenant',
      run: (config) => async (_req, ctx) => {
        if (!config.allowed.includes(ctx.tenantId)) {
          return {
            kind: 'reject',
            response: Response.json(
              { error: 'tenant_forbidden' },
              { status: 403 },
            ),
          }
        }
        return { kind: 'pass', contribution: { tenantId: ctx.tenantId } }
      },
    })

    const inner = vi.fn(innerOk)
    const fetchHandler = withTenantOnly({ allowed: ['acme'] }, inner)

    const blocked = await fetchHandler(new Request('http://localhost/'), {
      tenantId: 'evil-corp',
    })
    expect(blocked.status).toBe(403)
    expect(inner).not.toHaveBeenCalled()

    const ok = await fetchHandler(new Request('http://localhost/'), {
      tenantId: 'acme',
    })
    expect(ok.status).toBe(200)
    expect(inner).toHaveBeenCalledOnce()
  })

  it('threads upstream keys through to the inner handler unchanged', async () => {
    const withStamp = passingGate('stamp', { at: 42 })

    const fetchHandler = withStamp<{ tenantId: string }>(
      undefined,
      async (_req, ctx) =>
        Response.json({ tenant: ctx.tenantId, stamp: ctx.stamp.at }),
    )

    const res = await fetchHandler(new Request('http://localhost/'), {
      tenantId: 'acme',
    })
    expect(await res.json()).toEqual({ tenant: 'acme', stamp: 42 })
  })
})
