import { describe, expect, it, vi } from 'vitest'

import type { WithSupabaseConfig } from '../types.js'

import { defineAdapter } from './define-adapter.js'

const baseMock = vi.hoisted(() => ({ withSupabase: vi.fn() }))
vi.mock('../with-supabase.js', () => baseMock)

interface FakeContext {
  request: Request
}

const fakeAdapter = defineAdapter<FakeContext>({
  name: 'fake',
  extractRequest: (ctx) => ctx.request,
})

describe('defineAdapter', () => {
  it('forwards config and handler to base withSupabase once at construction', () => {
    baseMock.withSupabase.mockReturnValueOnce(async () => new Response())

    const config: WithSupabaseConfig = { auth: 'user' }
    const handler = async () => Response.json({})

    fakeAdapter(config, handler)

    expect(baseMock.withSupabase).toHaveBeenLastCalledWith(config, handler)
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
})
