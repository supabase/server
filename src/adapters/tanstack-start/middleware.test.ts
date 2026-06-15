import { describe, expect, it } from 'vitest'

import { AuthError } from '../../errors.js'
import type { SupabaseContext } from '../../types.js'
import { withSupabase } from './middleware.js'

const env = {
  url: 'https://test.supabase.co',
  publishableKeys: { default: 'sb_publishable_xyz' },
  secretKeys: { default: 'sb_secret_abc' },
  jwks: null,
}

/**
 * Invokes the request middleware's server handler with the given request (and
 * optional pre-existing context) and returns the context passed to `next()`.
 * Rejects if the middleware throws. Request middleware receives the `Request`
 * directly in its handler args, so no module-level mocking is required.
 */
async function run(
  middleware: ReturnType<typeof withSupabase>,
  request: Request,
  context: Record<string, unknown> = {},
): Promise<{ supabaseContext: SupabaseContext }> {
  const server = middleware.options.server as (opts: {
    request: Request
    pathname: string
    context: unknown
    handlerType: 'serverFn' | 'router'
    next: (ctx?: { context?: unknown }) => Promise<unknown>
  }) => Promise<unknown>

  let captured: { supabaseContext: SupabaseContext } | undefined
  await server({
    request,
    pathname: new URL(request.url).pathname,
    context,
    handlerType: 'serverFn',
    next: async (ctx) => {
      captured = ctx?.context as { supabaseContext: SupabaseContext }
      return { context: ctx?.context }
    },
  })
  return captured!
}

describe('tanstack-start supabase middleware', () => {
  it('builds supabase context on successful auth (none)', async () => {
    const ctx = await run(
      withSupabase({ auth: 'none', env }),
      new Request('http://localhost/'),
    )
    expect(ctx.supabaseContext.authMode).toBe('none')
    expect(ctx.supabaseContext.supabase).toBeTruthy()
    expect(ctx.supabaseContext.supabaseAdmin).toBeTruthy()
  })

  it('accepts a valid publishable key', async () => {
    const ctx = await run(
      withSupabase({ auth: 'publishable', env }),
      new Request('http://localhost/', {
        headers: { apikey: 'sb_publishable_xyz' },
      }),
    )
    expect(ctx.supabaseContext.authMode).toBe('publishable')
  })

  it('accepts a valid secret key', async () => {
    const ctx = await run(
      withSupabase({ auth: 'secret', env }),
      new Request('http://localhost/', {
        headers: { apikey: 'sb_secret_abc' },
      }),
    )
    expect(ctx.supabaseContext.authMode).toBe('secret')
  })

  it('supports the array form of auth modes (first match wins)', async () => {
    const ctx = await run(
      withSupabase({ auth: ['secret', 'publishable'], env }),
      new Request('http://localhost/', {
        headers: { apikey: 'sb_publishable_xyz' },
      }),
    )
    expect(ctx.supabaseContext.authMode).toBe('publishable')
  })

  it('throws AuthError when user auth has no token', async () => {
    await expect(
      run(
        withSupabase({ auth: 'user', env }),
        new Request('http://localhost/'),
      ),
    ).rejects.toMatchObject({
      name: 'AuthError',
      status: 401,
      code: 'INVALID_CREDENTIALS',
    })
  })

  it('throws an AuthError instance carrying status and code', async () => {
    const error = await run(
      withSupabase({ auth: 'publishable', env }),
      new Request('http://localhost/'),
    ).catch((e: unknown) => e)
    expect(error).toBeInstanceOf(AuthError)
    expect((error as AuthError).status).toBe(401)
  })

  it('throws when publishable auth is missing the apikey header', async () => {
    await expect(
      run(
        withSupabase({ auth: 'publishable', env }),
        new Request('http://localhost/'),
      ),
    ).rejects.toBeInstanceOf(AuthError)
  })

  it('skips auth when a prior middleware already set the context', async () => {
    const existing = { authMode: 'none' } as unknown as SupabaseContext
    // `secret` would fail without an apikey header, but the skip means the
    // auth flow never runs and the already-established context is preserved.
    const ctx = await run(
      withSupabase({ auth: 'secret', env }),
      new Request('http://localhost/'),
      { supabaseContext: existing },
    )
    expect(ctx.supabaseContext).toBe(existing)
  })
})
