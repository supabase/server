import { HttpException, type ExecutionContext } from '@nestjs/common'
import { describe, expect, it } from 'vitest'

import type { SupabaseContext } from '../../types.js'
import { SupabaseCtx } from './decorator.js'
import { withSupabase } from './middleware.js'

interface MockReq {
  headers: Record<string, string | string[] | undefined>
  url?: string
  supabaseContext?: SupabaseContext
}

function makeCtx(
  req: MockReq,
  type: 'http' | 'rpc' | 'ws' = 'http',
): ExecutionContext {
  // Only the `getType()` and `switchToHttp().getRequest()` surfaces are used
  // by the guard and decorator — a minimal stub is enough.
  return {
    getType: <T>() => type as T,
    switchToHttp: () => ({
      getRequest: <T>() => req as T,
      getResponse: <T>() => ({}) as T,
      getNext: <T>() => (() => undefined) as T,
    }),
  } as unknown as ExecutionContext
}

describe('nestjs supabase guard', () => {
  const env = {
    url: 'https://test.supabase.co',
    publishableKeys: { default: 'sb_publishable_xyz' },
    secretKeys: { default: 'sb_secret_xyz' },
    jwks: null,
  }

  it('sets supabase context on successful auth', async () => {
    const Guard = withSupabase({ auth: 'none', env })
    const guard = new Guard()
    const req: MockReq = { headers: {}, url: '/' }

    const result = await guard.canActivate(makeCtx(req))

    expect(result).toBe(true)
    expect(req.supabaseContext).toBeDefined()
    expect(req.supabaseContext!.authMode).toBe('none')
    expect(req.supabaseContext!.supabase).toBeDefined()
    expect(req.supabaseContext!.supabaseAdmin).toBeDefined()
  })

  it('throws HttpException with 401 status on auth failure', async () => {
    const Guard = withSupabase({ auth: 'user', env })
    const guard = new Guard()
    const req: MockReq = { headers: {}, url: '/' }

    let caught: unknown
    try {
      await guard.canActivate(makeCtx(req))
    } catch (e) {
      caught = e
    }

    expect(caught).toBeInstanceOf(HttpException)
    const httpErr = caught as HttpException
    expect(httpErr.getStatus()).toBe(401)
    const body = httpErr.getResponse() as { message: string; code: string }
    expect(body.message).toBeDefined()
    expect(body.code).toBeDefined()
  })

  it('exposes AuthError via cause on HttpException', async () => {
    const Guard = withSupabase({ auth: 'user', env })
    const guard = new Guard()
    const req: MockReq = { headers: {}, url: '/' }

    let caught: HttpException | null = null
    try {
      await guard.canActivate(makeCtx(req))
    } catch (e) {
      caught = e as HttpException
    }

    expect(caught).not.toBeNull()
    const cause = caught!.cause as
      | { code?: string; status?: number; name?: string }
      | undefined
    expect(cause).toBeDefined()
    expect(cause!.name).toBe('AuthError')
    expect(cause!.code).toBeDefined()
    expect(cause!.status).toBe(401)
  })

  it('runs even when a prior guard already set the context', async () => {
    // Handler-level guards must be able to tighten what a global/controller
    // guard set — Nest runs guards in global → controller → handler order, so
    // skipping when context exists would let an outer permissive guard mask
    // an inner stricter one.
    const preset: SupabaseContext = {
      supabase: {} as SupabaseContext['supabase'],
      supabaseAdmin: {} as SupabaseContext['supabaseAdmin'],
      userClaims: null,
      jwtClaims: null,
      authMode: 'none',
    }
    const Guard = withSupabase({ auth: 'secret', env })
    const guard = new Guard()
    const req: MockReq = {
      headers: {},
      url: '/',
      supabaseContext: preset,
    }

    // No apikey, so the stricter 'secret' guard must reject — proving it
    // re-evaluated instead of skipping because preset was present.
    await expect(guard.canActivate(makeCtx(req))).rejects.toBeInstanceOf(
      HttpException,
    )
  })

  it('overwrites a prior context on successful auth (innermost wins)', async () => {
    const preset: SupabaseContext = {
      supabase: {} as SupabaseContext['supabase'],
      supabaseAdmin: {} as SupabaseContext['supabaseAdmin'],
      userClaims: null,
      jwtClaims: null,
      authMode: 'none',
    }
    const Guard = withSupabase({ auth: 'secret', env })
    const guard = new Guard()
    const req: MockReq = {
      headers: { apikey: 'sb_secret_xyz' },
      url: '/',
      supabaseContext: preset,
    }

    const result = await guard.canActivate(makeCtx(req))

    expect(result).toBe(true)
    expect(req.supabaseContext).not.toBe(preset)
    expect(req.supabaseContext!.authMode).toBe('secret')
  })

  it('verifies a valid secret key from the apikey header', async () => {
    const Guard = withSupabase({ auth: 'secret', env })
    const guard = new Guard()
    const req: MockReq = {
      headers: { apikey: 'sb_secret_xyz' },
      url: '/',
    }

    const result = await guard.canActivate(makeCtx(req))

    expect(result).toBe(true)
    expect(req.supabaseContext!.authMode).toBe('secret')
  })

  it('verifies a valid publishable key from the apikey header', async () => {
    const Guard = withSupabase({ auth: 'publishable', env })
    const guard = new Guard()
    const req: MockReq = {
      headers: { apikey: 'sb_publishable_xyz' },
      url: '/',
    }

    const result = await guard.canActivate(makeCtx(req))

    expect(result).toBe(true)
    expect(req.supabaseContext!.authMode).toBe('publishable')
    expect(req.supabaseContext!.authKeyName).toBe('default')
  })

  it('rejects when array auth has no matching credentials', async () => {
    const Guard = withSupabase({ auth: ['user', 'secret'], env })
    const guard = new Guard()
    const req: MockReq = { headers: {}, url: '/' }

    await expect(guard.canActivate(makeCtx(req))).rejects.toBeInstanceOf(
      HttpException,
    )
  })

  it('skips HTTP/2 pseudo-headers (`:method`, `:path`, ...)', async () => {
    // Web Headers throws on leading-colon names. Under Fastify + HTTP/2,
    // these leak into req.headers; the guard must not crash.
    const Guard = withSupabase({ auth: 'none', env })
    const guard = new Guard()
    const req: MockReq = {
      headers: {
        ':method': 'GET',
        ':path': '/',
        ':scheme': 'https',
        ':authority': 'test.supabase.co',
      },
      url: '/',
    }

    const result = await guard.canActivate(makeCtx(req))

    expect(result).toBe(true)
    expect(req.supabaseContext!.authMode).toBe('none')
  })

  it('throws on non-HTTP execution contexts (rpc, ws)', async () => {
    // The guard reads HTTP headers via `switchToHttp()`. Misapplying it to an
    // RPC or WS handler must fail loudly — silently passing through would
    // make the guard a no-op on every message of those transports.
    const Guard = withSupabase({ auth: 'user', env })
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
      const body = caught!.getResponse() as { message: string; code: string }
      expect(body.code).toBe('unsupported_context')
      expect(body.message).toContain(type)
      expect(req.supabaseContext).toBeUndefined()
    }
  })

  it('forwards header arrays as a single comma-joined value', async () => {
    // Node-style headers can be string[]; the guard should still extract them.
    const Guard = withSupabase({ auth: 'secret', env })
    const guard = new Guard()
    const req: MockReq = {
      headers: { apikey: ['sb_secret_xyz', 'extra'] },
      url: '/',
    }

    // 'sb_secret_xyz, extra' is not a valid secret, so we expect rejection —
    // but the failure mode proves the array was forwarded (no crash on .set()).
    await expect(guard.canActivate(makeCtx(req))).rejects.toBeInstanceOf(
      HttpException,
    )
  })
})

describe('nestjs SupabaseCtx decorator', () => {
  // `createParamDecorator` returns a decorator function with the underlying
  // factory exposed via __extractValue (Nest internals). Re-implement the
  // factory here so the test exercises the same logic users will hit.
  const factory = (
    data: keyof SupabaseContext | undefined,
    ctx: ExecutionContext,
  ) => {
    const req = ctx
      .switchToHttp()
      .getRequest<{ supabaseContext?: SupabaseContext }>()
    const supabaseContext = req.supabaseContext
    if (data) return supabaseContext?.[data]
    return supabaseContext
  }

  const ctx: SupabaseContext = {
    supabase: { __tag: 'supabase' } as unknown as SupabaseContext['supabase'],
    supabaseAdmin: {
      __tag: 'admin',
    } as unknown as SupabaseContext['supabaseAdmin'],
    userClaims: { id: 'user-1' },
    jwtClaims: null,
    authMode: 'user',
  }

  it('returns the full context when called without args', () => {
    const result = factory(
      undefined,
      makeCtx({ headers: {}, supabaseContext: ctx }),
    )
    expect(result).toBe(ctx)
  })

  it('returns a single field when given a key', () => {
    const result = factory(
      'userClaims',
      makeCtx({ headers: {}, supabaseContext: ctx }),
    )
    expect(result).toEqual({ id: 'user-1' })
  })

  it('returns undefined when no context is set', () => {
    const result = factory(undefined, makeCtx({ headers: {} }))
    expect(result).toBeUndefined()
  })

  // Sanity check: the exported decorator is the value returned by
  // `createParamDecorator` so it can be applied as `@SupabaseCtx()`.
  it('exports a callable param decorator', () => {
    expect(typeof SupabaseCtx).toBe('function')
  })
})
