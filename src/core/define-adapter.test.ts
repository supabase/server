import { describe, expect, it, vi } from 'vitest'

import { AuthError } from '../errors.js'
import type { SupabaseContext, WithSupabaseConfig } from '../types.js'

import { defineAdapter } from './define-adapter.js'

const baseMock = vi.hoisted(() => ({ withSupabase: vi.fn() }))
vi.mock('../with-supabase.js', () => baseMock)

interface FakeContext {
  request: Request
  supabaseContext?: SupabaseContext
}

const fakeAdapter = defineAdapter<FakeContext>({
  name: 'fake',
  extractRequest: (ctx) => ctx.request,
})

describe('defineAdapter', () => {
  it('forwards config and handler to base, augmenting cors: false', () => {
    baseMock.withSupabase.mockReturnValueOnce(async () => new Response())

    const config: WithSupabaseConfig = { auth: 'user' }
    const handler = async () => Response.json({})

    fakeAdapter(config, handler)

    // The adapter forces cors off so the framework owns CORS, and
    // forwards every other field of the user's config.
    expect(baseMock.withSupabase).toHaveBeenLastCalledWith(
      { auth: 'user', cors: false },
      handler,
    )
  })

  it('passes a plain Request straight through to base', async () => {
    const baseResponse = new Response('ok')
    const inner = vi.fn(async () => baseResponse)
    baseMock.withSupabase.mockReturnValueOnce(inner)

    const wrapped = fakeAdapter({ auth: 'user' }, async () => new Response())
    const req = new Request('https://example.test/')

    const res = await wrapped(req)

    expect(inner).toHaveBeenCalledWith(req)
    expect(res).toBe(baseResponse)
  })

  it('extracts the Request from the framework context and forwards it', async () => {
    const baseResponse = new Response('ok')
    const inner = vi.fn(async () => baseResponse)
    baseMock.withSupabase.mockReturnValueOnce(inner)

    const wrapped = fakeAdapter({ auth: 'user' }, async () => new Response())
    const req = new Request('https://example.test/')

    const res = await wrapped({ request: req })

    expect(inner).toHaveBeenCalledWith(req)
    expect(res).toBe(baseResponse)
  })

  it('throws TypeError with the adapter name when input is unrecognized', () => {
    baseMock.withSupabase.mockReturnValueOnce(async () => new Response())

    const wrapped = fakeAdapter({ auth: 'user' }, async () => new Response())

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

  it('throws when extractRequest returns a non-Request', () => {
    baseMock.withSupabase.mockReturnValueOnce(async () => new Response())

    const looseAdapter = defineAdapter<{ request?: unknown }>({
      name: 'loose',
      extractRequest: (ctx) => ctx.request as Request | undefined,
    })

    const wrapped = looseAdapter({ auth: 'user' }, async () => new Response())

    expect(() => wrapped({ request: 'not a request' })).toThrow(TypeError)
    expect(() => wrapped({})).toThrow(TypeError)
  })

  describe('getExistingContext (skip-if-set)', () => {
    const skipAdapter = defineAdapter<FakeContext>({
      name: 'skip-fake',
      extractRequest: (ctx) => ctx.request,
      getExistingContext: (ctx) => ctx.supabaseContext,
    })

    it('invokes the handler directly with the existing ctx when present', async () => {
      const inner = vi.fn()
      baseMock.withSupabase.mockReturnValueOnce(inner)

      const userHandler = vi.fn(async () => Response.json({ ok: true }))
      const wrapped = skipAdapter({ auth: 'user' }, userHandler)

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
      const wrapped = skipAdapter({ auth: 'user' }, userHandler)

      const req = new Request('https://example.test/')
      await wrapped({ request: req })

      expect(userHandler).not.toHaveBeenCalled()
      expect(inner).toHaveBeenCalledWith(req)
    })

    it('does not consult getExistingContext when input is a plain Request', async () => {
      const inner = vi.fn(async () => new Response('via base'))
      baseMock.withSupabase.mockReturnValueOnce(inner)

      const userHandler = vi.fn(async () => new Response())
      const wrapped = skipAdapter({ auth: 'user' }, userHandler)

      const req = new Request('https://example.test/')
      await wrapped(req)

      expect(userHandler).not.toHaveBeenCalled()
      expect(inner).toHaveBeenCalledWith(req)
    })
  })

  describe('throwAuthError', () => {
    class FrameworkError extends Error {
      readonly cause: AuthError
      constructor(error: AuthError) {
        super('framework-native')
        this.cause = error
      }
    }

    const throwingAdapter = defineAdapter<FakeContext>({
      name: 'throw-fake',
      extractRequest: (ctx) => ctx.request,
      throwAuthError: (error) => {
        throw new FrameworkError(error)
      },
    })

    it('passes throwAuthError as onAuthError on the base config', () => {
      baseMock.withSupabase.mockReturnValueOnce(async () => new Response())

      throwingAdapter({ auth: 'user' }, async () => new Response())

      const [calledConfig] = baseMock.withSupabase.mock.calls.at(-1) as [
        WithSupabaseConfig,
        unknown,
      ]
      expect(calledConfig.onAuthError).toBeTypeOf('function')
      expect(calledConfig.cors).toBe(false)
    })

    it('does not pass onAuthError when throwAuthError is omitted', () => {
      baseMock.withSupabase.mockReturnValueOnce(async () => new Response())

      fakeAdapter({ auth: 'user' }, async () => new Response())

      const [calledConfig] = baseMock.withSupabase.mock.calls.at(-1) as [
        WithSupabaseConfig,
        unknown,
      ]
      expect(calledConfig.onAuthError).toBeUndefined()
    })
  })
})
