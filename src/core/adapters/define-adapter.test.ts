import { describe, expect, it, vi } from 'vitest'

import { AuthError } from '../../errors.js'
import type { SupabaseContext, WithSupabaseConfig } from '../../types.js'

import { defineAdapter } from './define-adapter.js'

const baseMock = vi.hoisted(() => ({ withSupabase: vi.fn() }))
vi.mock('../../with-supabase.js', () => baseMock)

interface FakeContext {
  request: Request
  supabaseContext?: SupabaseContext
}

const MIDDLEWARE_SENTINEL = Symbol('middleware')
type Middleware = {
  tag: typeof MIDDLEWARE_SENTINEL
  config?: WithSupabaseConfig
}

const fake = defineAdapter<FakeContext, Middleware>({
  name: 'fake',
  extractRequest: (ctx) => ctx.request,
  middleware: (config) => ({ tag: MIDDLEWARE_SENTINEL, config }),
})

describe('defineAdapter — one-arg form (middleware)', () => {
  it('returns whatever the spec.middleware factory returns, passing config through', () => {
    const result = fake.withSupabase({ auth: 'user' })
    expect(result).toEqual({
      tag: MIDDLEWARE_SENTINEL,
      config: { auth: 'user' },
    })
  })

  it('accepts a no-arg call (config is undefined)', () => {
    const result = fake.withSupabase()
    expect(result).toEqual({
      tag: MIDDLEWARE_SENTINEL,
      config: undefined,
    })
  })

  it('does not call base.withSupabase for the one-arg form', () => {
    baseMock.withSupabase.mockClear()
    fake.withSupabase({ auth: 'user' })
    expect(baseMock.withSupabase).not.toHaveBeenCalled()
  })
})

describe('defineAdapter — two-arg form (route handler)', () => {
  it('forwards config and handler to base, augmenting cors: false', () => {
    baseMock.withSupabase.mockReturnValueOnce(async () => new Response())

    const config = { auth: 'user' } as const
    const handler = async () => Response.json({})

    fake.withSupabase(config, handler)

    expect(baseMock.withSupabase).toHaveBeenLastCalledWith(
      { auth: 'user', cors: false },
      handler,
    )
  })

  it('passes a plain Request straight through to base', async () => {
    const baseResponse = new Response('ok')
    const inner = vi.fn(async () => baseResponse)
    baseMock.withSupabase.mockReturnValueOnce(inner)

    const wrapped = fake.withSupabase(
      { auth: 'user' },
      async () => new Response(),
    )
    const req = new Request('https://example.test/')

    const res = await wrapped(req)

    expect(inner).toHaveBeenCalledWith(req)
    expect(res).toBe(baseResponse)
  })

  it('extracts the Request from the framework context and forwards it', async () => {
    const baseResponse = new Response('ok')
    const inner = vi.fn(async () => baseResponse)
    baseMock.withSupabase.mockReturnValueOnce(inner)

    const wrapped = fake.withSupabase(
      { auth: 'user' },
      async () => new Response(),
    )
    const req = new Request('https://example.test/')

    const res = await wrapped({ request: req })

    expect(inner).toHaveBeenCalledWith(req)
    expect(res).toBe(baseResponse)
  })

  it('throws TypeError with the adapter name when input is unrecognized', () => {
    baseMock.withSupabase.mockReturnValueOnce(async () => new Response())

    const wrapped = fake.withSupabase(
      { auth: 'user' },
      async () => new Response(),
    )

    try {
      // @ts-expect-error — intentionally wrong shape
      wrapped({ wrong: 'shape' })
      expect.fail('should have thrown')
    } catch (e) {
      expect(e).toBeInstanceOf(TypeError)
      expect((e as Error).message).toContain('@supabase/server/adapters/fake')
      expect((e as Error).message).toContain('Object')
    }
  })
})

describe('defineAdapter — getExistingContext (skip-if-set)', () => {
  const skip = defineAdapter<FakeContext, Middleware>({
    name: 'skip-fake',
    extractRequest: (ctx) => ctx.request,
    getExistingContext: (ctx) => ctx.supabaseContext,
    middleware: (config) => ({ tag: MIDDLEWARE_SENTINEL, config }),
  })

  it('invokes the handler directly with the existing ctx when present', async () => {
    const inner = vi.fn()
    baseMock.withSupabase.mockReturnValueOnce(inner)

    const userHandler = vi.fn(async () => Response.json({ ok: true }))
    const wrapped = skip.withSupabase({ auth: 'user' }, userHandler)

    const req = new Request('https://example.test/')
    const existingCtx = { authMode: 'user' } as unknown as SupabaseContext
    const res = await wrapped({ request: req, supabaseContext: existingCtx })

    expect(inner).not.toHaveBeenCalled()
    expect(userHandler).toHaveBeenCalledWith(req, existingCtx)
    expect(res.status).toBe(200)
  })

  it('falls through to base when no existing ctx is attached', async () => {
    const inner = vi.fn(async () => new Response('via base'))
    baseMock.withSupabase.mockReturnValueOnce(inner)

    const userHandler = vi.fn(async () => new Response())
    const wrapped = skip.withSupabase({ auth: 'user' }, userHandler)

    const req = new Request('https://example.test/')
    await wrapped({ request: req })

    expect(userHandler).not.toHaveBeenCalled()
    expect(inner).toHaveBeenCalledWith(req)
  })

  it('does not consult getExistingContext when input is a plain Request', async () => {
    const inner = vi.fn(async () => new Response('via base'))
    baseMock.withSupabase.mockReturnValueOnce(inner)

    const userHandler = vi.fn(async () => new Response())
    const wrapped = skip.withSupabase({ auth: 'user' }, userHandler)

    const req = new Request('https://example.test/')
    await wrapped(req)

    expect(userHandler).not.toHaveBeenCalled()
    expect(inner).toHaveBeenCalledWith(req)
  })
})

describe('defineAdapter — throwAuthError', () => {
  class FrameworkError extends Error {
    readonly cause: AuthError
    constructor(error: AuthError) {
      super('framework-native')
      this.cause = error
    }
  }

  const throwing = defineAdapter<FakeContext, Middleware>({
    name: 'throw-fake',
    extractRequest: (ctx) => ctx.request,
    throwAuthError: (error) => {
      throw new FrameworkError(error)
    },
    middleware: (config) => ({ tag: MIDDLEWARE_SENTINEL, config }),
  })

  it('passes throwAuthError as onAuthError on the base config (two-arg form)', () => {
    baseMock.withSupabase.mockReturnValueOnce(async () => new Response())

    throwing.withSupabase({ auth: 'user' }, async () => new Response())

    const [calledConfig] = baseMock.withSupabase.mock.calls.at(-1) as [
      WithSupabaseConfig,
      unknown,
    ]
    expect(calledConfig.onAuthError).toBeTypeOf('function')
    expect(calledConfig.cors).toBe(false)
  })

  it('does not pass onAuthError when throwAuthError is omitted', () => {
    baseMock.withSupabase.mockReturnValueOnce(async () => new Response())

    fake.withSupabase({ auth: 'user' }, async () => new Response())

    const [calledConfig] = baseMock.withSupabase.mock.calls.at(-1) as [
      WithSupabaseConfig,
      unknown,
    ]
    expect(calledConfig.onAuthError).toBeUndefined()
  })
})
