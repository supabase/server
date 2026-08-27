import { beforeEach, describe, expect, expectTypeOf, it, vi } from 'vitest'
import { defineMiddleware, getEnv } from '@supabase/middleware'
import type { Entry, FetchHandler } from '@supabase/middleware'

import { _resetAllowDeprecationWarned } from './core/utils/deprecation.js'
import { createSupabaseContext } from './create-supabase-context.js'
import {
  EnvError,
  ErrorCodeHeader,
  JwksNotConfiguredError,
  MissingCredentialsError,
  MissingDefaultSecretKeyError,
} from './errors.js'
import type { WithSupabaseConfig } from './types.js'
import { withClaims } from './middleware/claims/index.js'
import { withPostgresClient } from './middleware/postgres/index.js'
import { withOAuthProtectedResource } from './oauth-protected-resource/with-oauth-protected-resource.js'
import { withSupabase } from './with-supabase.js'

const baseEnv = {
  url: 'https://test.supabase.co',
  publishableKeys: { default: 'sb_publishable_xyz' },
  secretKeys: { default: 'sb_secret_xyz' },
  jwks: null,
}

describe('withSupabase', () => {
  it('handles OPTIONS preflight with CORS', async () => {
    const handler = withSupabase({ auth: 'none', env: baseEnv }, async () =>
      Response.json({ ok: true }),
    )

    const req = new Request('http://localhost', { method: 'OPTIONS' })
    const res = await handler(req)
    expect(res.status).toBe(204)
    expect(res.headers.get('Access-Control-Allow-Origin')).toBe('*')
  })

  it('skips OPTIONS handling when cors is false', async () => {
    const handler = withSupabase(
      { auth: 'none', env: baseEnv, cors: false },
      async () => Response.json({ ok: true }),
    )

    const req = new Request('http://localhost', { method: 'OPTIONS' })
    const res = await handler(req)
    // When CORS disabled, OPTIONS goes through normal flow
    expect(res.status).toBe(200)
  })

  it('calls handler with context on successful auth', async () => {
    const handler = withSupabase(
      { auth: 'none', env: baseEnv },
      async (_req, ctx) => {
        return Response.json({
          authMode: ctx.authMode,
          hasSupabase: !!ctx.supabase,
          hasAdmin: !!ctx.supabaseAdmin,
        })
      },
    )

    const req = new Request('http://localhost')
    const res = await handler(req)
    const body = await res.json()
    expect(body.authMode).toBe('none')
    expect(body.hasSupabase).toBe(true)
    expect(body.hasAdmin).toBe(true)
  })

  it('returns error response on auth failure', async () => {
    const handler = withSupabase({ auth: 'user', env: baseEnv }, async () =>
      Response.json({ ok: true }),
    )

    const req = new Request('http://localhost')
    const res = await handler(req)
    expect(res.status).toBe(401)
    const body = await res.json()
    expect(body.message).toBeDefined()
    expect(body.code).toBeDefined()
  })

  describe('error response shape', () => {
    async function errorResponse(config?: Partial<WithSupabaseConfig>) {
      const handler = withSupabase(
        { auth: 'user', env: baseEnv, ...config },
        async () => Response.json({ ok: true }),
      )
      return handler(new Request('http://localhost'))
    }

    it('returns the full diagnostic payload', async () => {
      const body = await (await errorResponse()).json()

      expect(body).toEqual({
        source: '@supabase/server',
        code: MissingCredentialsError,
        message: expect.stringContaining('[@supabase/server] '),
        hint: expect.stringContaining('Authorization: Bearer <jwt>'),
        docs: expect.stringContaining('error-handling.md#missing_credentials'),
        details: {
          acceptedAuthModes: ['user'],
          received: { authorization: 'absent', apikey: 'absent' },
        },
      })
    })

    it('keeps message and code at the top level for existing consumers', async () => {
      const body = await (await errorResponse()).json()
      expect(typeof body.message).toBe('string')
      expect(body.code).toBe(MissingCredentialsError)
    })

    it('repeats the code in the x-supabase-server-error header', async () => {
      const res = await errorResponse()
      expect(res.headers.get(ErrorCodeHeader)).toBe(MissingCredentialsError)
    })

    it('exposes the code header to cross-origin callers', async () => {
      const res = await errorResponse()
      expect(res.headers.get('Access-Control-Expose-Headers')).toBe(
        ErrorCodeHeader,
      )
    })

    it('appends to an existing Access-Control-Expose-Headers value', async () => {
      const res = await errorResponse({
        cors: {
          headers: {
            'Access-Control-Allow-Origin': '*',
            'Access-Control-Expose-Headers': 'x-request-id',
          },
        },
      })
      expect(res.headers.get('Access-Control-Expose-Headers')).toBe(
        `x-request-id, ${ErrorCodeHeader}`,
      )
    })

    it('still sets the code header when CORS is disabled', async () => {
      const res = await errorResponse({ cors: 'disabled' })
      expect(res.headers.get(ErrorCodeHeader)).toBe(MissingCredentialsError)
      expect(res.headers.get('Access-Control-Expose-Headers')).toBeNull()
    })

    it('reports a missing JWKS as a 500, not a 401', async () => {
      const handler = withSupabase({ auth: 'user', env: baseEnv }, async () =>
        Response.json({ ok: true }),
      )
      const res = await handler(
        new Request('http://localhost', {
          headers: { authorization: 'Bearer header.payload.signature' },
        }),
      )
      expect(res.status).toBe(500)
      expect(res.headers.get(ErrorCodeHeader)).toBe(JwksNotConfiguredError)
      expect((await res.json()).hint).toContain('SUPABASE_JWKS_URL')
    })

    it('carries the specific env code through a client-phase failure', async () => {
      // The client middleware throws an EnvError; its code, hint, and details
      // must survive rather than collapsing to a generic client error.
      const handler = withSupabase(
        { auth: 'none', env: { ...baseEnv, publishableKeys: {} } },
        async () => Response.json({ ok: true }),
      )
      const res = await handler(new Request('http://localhost'))
      expect(res.status).toBe(500)
      const body = await res.json()
      expect(body.code).toBe('MISSING_DEFAULT_PUBLISHABLE_KEY')
      expect(body.hint).toContain('SUPABASE_PUBLISHABLE_KEY')
      expect(res.headers.get(ErrorCodeHeader)).toBe(
        'MISSING_DEFAULT_PUBLISHABLE_KEY',
      )
    })

    describe('errors: { detailed: false }', () => {
      it('reduces the body to code and message alone', async () => {
        const body = await (
          await errorResponse({ errors: { detailed: false } })
        ).json()

        expect(body).toEqual({
          code: MissingCredentialsError,
          // Provenance survives in the prefix, without the `source` field.
          message: expect.stringContaining('[@supabase/server] '),
        })
      })

      it('keeps the status and the code header', async () => {
        const res = await errorResponse({ errors: { detailed: false } })
        expect(res.status).toBe(401)
        expect(res.headers.get(ErrorCodeHeader)).toBe(MissingCredentialsError)
      })

      it('is detailed by default and when explicitly enabled', async () => {
        for (const config of [{}, { errors: { detailed: true } }]) {
          const body = await (await errorResponse(config)).json()
          expect(body.hint).toBeDefined()
          expect(body.details).toBeDefined()
        }
      })

      it('leaves the error object itself fully populated', async () => {
        // The trim is response-only — createSupabaseContext callers and the
        // adapters read the error directly and must still see everything.
        const { error } = await createSupabaseContext(
          new Request('http://localhost'),
          { auth: 'user', env: baseEnv, errors: { detailed: false } },
        )
        expect(error!.hint).toBeDefined()
        expect(error!.details).toBeDefined()
      })
    })
  })

  it('adds CORS headers to success response', async () => {
    const handler = withSupabase({ auth: 'none', env: baseEnv }, async () =>
      Response.json({ ok: true }),
    )

    const req = new Request('http://localhost')
    const res = await handler(req)
    expect(res.headers.get('Access-Control-Allow-Origin')).toBe('*')
  })

  it('adds CORS headers to error response', async () => {
    const handler = withSupabase({ auth: 'user', env: baseEnv }, async () =>
      Response.json({ ok: true }),
    )

    const req = new Request('http://localhost')
    const res = await handler(req)
    expect(res.headers.get('Access-Control-Allow-Origin')).toBe('*')
  })

  it('does not add CORS headers when cors is false', async () => {
    const handler = withSupabase(
      { auth: 'none', env: baseEnv, cors: false },
      async () => Response.json({ ok: true }),
    )

    const req = new Request('http://localhost')
    const res = await handler(req)
    expect(res.headers.get('Access-Control-Allow-Origin')).toBeNull()
  })

  describe('explicit cors shape', () => {
    it("skips OPTIONS handling when cors is 'disabled'", async () => {
      const handler = withSupabase(
        { auth: 'none', env: baseEnv, cors: 'disabled' },
        async () => Response.json({ ok: true }),
      )

      const req = new Request('http://localhost', { method: 'OPTIONS' })
      const res = await handler(req)
      // When CORS disabled, OPTIONS goes through normal flow
      expect(res.status).toBe(200)
    })

    it("does not add CORS headers when cors is 'disabled'", async () => {
      const handler = withSupabase(
        { auth: 'none', env: baseEnv, cors: 'disabled' },
        async () => Response.json({ ok: true }),
      )

      const req = new Request('http://localhost')
      const res = await handler(req)
      expect(res.headers.get('Access-Control-Allow-Origin')).toBeNull()
    })

    it('applies custom { headers } to the success response', async () => {
      const handler = withSupabase(
        {
          auth: 'none',
          env: baseEnv,
          cors: { headers: { 'Access-Control-Allow-Origin': 'https://a.com' } },
        },
        async () => Response.json({ ok: true }),
      )

      const req = new Request('http://localhost')
      const res = await handler(req)
      expect(res.headers.get('Access-Control-Allow-Origin')).toBe(
        'https://a.com',
      )
    })

    it('applies custom { headers } to the error response', async () => {
      const handler = withSupabase(
        {
          auth: 'user',
          env: baseEnv,
          cors: { headers: { 'Access-Control-Allow-Origin': 'https://a.com' } },
        },
        async () => Response.json({ ok: true }),
      )

      const req = new Request('http://localhost')
      const res = await handler(req)
      expect(res.status).toBe(401)
      expect(res.headers.get('Access-Control-Allow-Origin')).toBe(
        'https://a.com',
      )
    })
  })

  describe('middleware', () => {
    it('composes middleware after the Supabase context is established', async () => {
      const withFlag = defineMiddleware<
        'flag',
        void,
        Record<never, never>,
        boolean
      >({
        key: 'flag',
        run: () => async () => ({ flag: true }),
      })

      const handler = withSupabase(
        { auth: 'none', env: baseEnv, middleware: [withFlag()] },
        async (_req, ctx) =>
          Response.json({ authMode: ctx.authMode, flag: ctx.flag }),
      )

      const res = await handler(new Request('http://localhost'))
      const body = await res.json()
      expect(body.authMode).toBe('none')
      expect(body.flag).toBe(true)
    })

    it('middleware receives the Supabase context at runtime', async () => {
      let capturedHasSupabase = false

      const withCapture = defineMiddleware<
        'captured',
        void,
        Record<never, never>,
        boolean
      >({
        key: 'captured',
        run: () => async (_req, ctx) => {
          capturedHasSupabase = !!(ctx as { supabase?: unknown }).supabase
          return { captured: capturedHasSupabase }
        },
      })

      const handler = withSupabase(
        { auth: 'none', env: baseEnv, middleware: [withCapture()] },
        async (_, ctx) => Response.json({ captured: ctx.captured }),
      )

      const res = await handler(new Request('http://localhost'))
      const body = await res.json()
      expect(body.captured).toBe(capturedHasSupabase)
      expect(capturedHasSupabase).toBe(true)
    })

    it('middleware can short-circuit before the handler', async () => {
      const withBlock = defineMiddleware<
        'blocked',
        void,
        Record<never, never>,
        true
      >({
        key: 'blocked',
        run: () => async () => new Response('blocked', { status: 403 }),
      })

      const innerHandler = vi.fn(async () => Response.json({ ok: true }))

      const handler = withSupabase(
        { auth: 'none', env: baseEnv, middleware: [withBlock()] },
        innerHandler,
      )

      const res = await handler(new Request('http://localhost'))
      expect(res.status).toBe(403)
      expect(innerHandler).not.toHaveBeenCalled()
    })

    it('middleware run in array order (first = outermost, runs first on request)', async () => {
      const order: string[] = []

      const withA = defineMiddleware<'a', void, Record<never, never>, true>({
        key: 'a',
        run: () => async () => {
          order.push('a')
          return { a: true as const }
        },
      })
      const withB = defineMiddleware<'b', void, Record<never, never>, true>({
        key: 'b',
        run: () => async () => {
          order.push('b')
          return { b: true as const }
        },
      })

      const handler = withSupabase(
        { auth: 'none', env: baseEnv, middleware: [withA(), withB()] },
        async (_req, ctx) => Response.json({ a: ctx.a, b: ctx.b }),
      )

      const res = await handler(new Request('http://localhost'))
      const body = await res.json()
      expect(order).toEqual(['a', 'b'])
      expect(body).toEqual({ a: true, b: true })
    })

    it('middleware run in array order with shared ctx dependency', async () => {
      const withFirst = defineMiddleware<
        'a',
        void,
        Record<never, never>,
        string
      >({
        key: 'a',
        run: () => async () => ({ a: 'http://localhost' as const }),
      })
      const withSecond = defineMiddleware<'b', void, { a: string }, URL>({
        key: 'b',
        run: () => async (_req, ctx) => {
          const url = URL.parse(ctx.a)
          url!.pathname = '/supabase'

          return { b: url! }
        },
      })

      const handler = withSupabase(
        { auth: 'none', env: baseEnv, middleware: [withFirst(), withSecond()] },
        async (_req, ctx) => Response.json({ a: ctx.a, b: ctx.b }),
      )

      const res = await handler(new Request('http://localhost'))
      const body = await res.json()
      expect(body).toEqual({
        a: 'http://localhost',
        b: 'http://localhost/supabase',
      })

      // Reverse order is a compile-time ordering error; at runtime the
      // broken dependency chain throws all the same.
      // @ts-expect-error — prereq 'a' is not yet on the context
      const handlerReverse = withSupabase(
        { auth: 'none', env: baseEnv, middleware: [withSecond(), withFirst()] },
        async (_req: Request, ctx: { a: string; b: URL }) =>
          Response.json({ a: ctx.a, b: ctx.b }),
      )

      expect(handlerReverse(new Request('http://localhost'))).rejects.toThrow(
        "Cannot set properties of null (setting 'pathname')",
      )
    })

    it("forwards the host's second fetch argument to getEnv as platform env", async () => {
      const withReadEnv = defineMiddleware<
        'bindingValue',
        void,
        Record<never, never>,
        string | undefined
      >({
        key: 'bindingValue',
        run: () => async () => ({
          bindingValue: getEnv('WITH_SUPABASE_TEST_BINDING'),
        }),
      })

      const handler = withSupabase(
        { auth: 'none', env: baseEnv, middleware: [withReadEnv()] },
        async (_req, ctx) => Response.json({ bindingValue: ctx.bindingValue }),
      )

      // Simulate a Workers-style invocation: fetch(request, env).
      const res = await handler(new Request('http://localhost'), {
        WITH_SUPABASE_TEST_BINDING: 'from-platform',
      })
      const body = await res.json()
      expect(body).toEqual({ bindingValue: 'from-platform' })
    })

    it('CORS headers still apply when middleware are present', async () => {
      const withNoop = defineMiddleware<
        'noop',
        void,
        Record<never, never>,
        true
      >({
        key: 'noop',
        run: () => async () => ({ noop: true as const }),
      })

      const handler = withSupabase(
        { auth: 'none', env: baseEnv, middleware: [withNoop()] },
        async () => Response.json({ ok: true }),
      )

      const res = await handler(new Request('http://localhost'))
      expect(res.headers.get('Access-Control-Allow-Origin')).toBe('*')
    })
  })

  describe('nested under an upstream middleware', () => {
    // Nested under another entry, withSupabase must spread the upstream context
    // rather than reseed — otherwise it drops upstream ctx keys and clobbers the
    // platform env the entry captured (silently breaking getEnv on Workers).
    it('preserves upstream ctx keys and the platform env captured by the entry', async () => {
      let seenMetadataUrl: string | undefined
      let seenBinding: string | undefined

      const composed = withOAuthProtectedResource(
        { resourceServer: 'http://localhost/my-fn' },
        withSupabase({ auth: 'none', env: baseEnv }, async (_req, ctx) => {
          // The `satisfies FetchHandler` anchor below is what lets `Base` flow
          // in from the outer middleware. This line is the type test for that
          // flow; a cast here would mask a regression.
          seenMetadataUrl = ctx.oauthProtectedResource.resourceMetadataUrl
          seenBinding = getEnv('NESTED_TEST_BINDING')
          return Response.json({ ok: true })
        }),
      ) satisfies FetchHandler

      // Workers-style entry invocation: fetch(request, env). withOAuthProtected-
      // Resource is the entry, so it seeds the context with this env.
      const res = await composed(new Request('http://localhost/my-fn'), {
        NESTED_TEST_BINDING: 'from-platform',
      })

      expect(res.status).toBe(200)
      // Upstream contribution survived withSupabase's context construction.
      expect(seenMetadataUrl).toContain('/my-fn/oauth-protected-resource')
      // Platform env captured by the entry was not clobbered by a reseed.
      expect(seenBinding).toBe('from-platform')
    })
  })

  describe('client construction errors', () => {
    it('maps client-construction EnvError to a 500 JSON response', async () => {
      const handler = withSupabase(
        {
          auth: 'none',
          env: { ...baseEnv, publishableKeys: {} },
        },
        async () => Response.json({ ok: true }),
      )

      const res = await handler(new Request('http://localhost'))
      expect(res.status).toBe(500)
      const body = await res.json()
      expect(body.code).toBe('MISSING_DEFAULT_PUBLISHABLE_KEY')
    })

    it('lets EnvError thrown by the handler propagate instead of mapping it', async () => {
      const handler = withSupabase({ auth: 'none', env: baseEnv }, async () => {
        throw new EnvError('handler-level env failure')
      })

      await expect(handler(new Request('http://localhost'))).rejects.toThrow(
        'handler-level env failure',
      )
    })

    it('serves requests without a secret key when the handler never accesses supabaseAdmin', async () => {
      let ran = false
      const handler = withSupabase(
        {
          auth: 'none',
          env: { ...baseEnv, secretKeys: {} },
        },
        async () => {
          ran = true
          return Response.json({ ok: true })
        },
      )

      const res = await handler(new Request('http://localhost'))
      expect(res.status).toBe(200)
      expect(ran).toBe(true)
    })

    it('propagates the missing-secret-key EnvError at the supabaseAdmin access point', async () => {
      const handler = withSupabase(
        {
          auth: 'none',
          env: { ...baseEnv, secretKeys: {} },
        },
        async (_req, ctx) => {
          ctx.supabaseAdmin.from('t')
          return Response.json({ ok: true })
        },
      )

      await expect(
        handler(new Request('http://localhost')),
      ).rejects.toMatchObject({ code: MissingDefaultSecretKeyError })
    })
  })

  describe('allow → auth deprecation', () => {
    beforeEach(() => {
      _resetAllowDeprecationWarned()
    })

    it('still works with the deprecated `allow` option', async () => {
      const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
      const handler = withSupabase(
        { allow: 'none', env: baseEnv },
        async (_req, ctx) => Response.json({ authMode: ctx.authMode }),
      )

      const req = new Request('http://localhost')
      const res = await handler(req)
      expect(res.status).toBe(200)
      const body = await res.json()
      expect(body.authMode).toBe('none')
      expect(warn).toHaveBeenCalled()
      warn.mockRestore()
    })

    it('does not warn when `auth` is used', async () => {
      const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
      const handler = withSupabase({ auth: 'none', env: baseEnv }, async () =>
        Response.json({ ok: true }),
      )
      const req = new Request('http://localhost')
      await handler(req)
      expect(warn).not.toHaveBeenCalled()
      warn.mockRestore()
    })
  })
})

describe('type guarantees (tsc-verified)', () => {
  const withProvider = defineMiddleware<
    'prov',
    void,
    Record<never, never>,
    { v: number }
  >({
    key: 'prov',
    run: () => async () => ({ prov: { v: 1 } }),
  })

  const withNeedsProv = defineMiddleware<
    'dep',
    void,
    { prov: { v: number } },
    { ok: true }
  >({
    key: 'dep',
    run: () => async () => ({ dep: { ok: true as const } }),
  })

  it('an entry may declare a prerequisite on a Supabase-provided key', () => {
    // withPostgresClient declares In: { jwtClaims }; the SupabaseContext
    // seed satisfies it, so composing it here compiles.
    const _handler = withSupabase(
      { auth: 'none', env: baseEnv, middleware: [withPostgresClient()] },
      async (_req, ctx) => {
        expectTypeOf(ctx.postgres).not.toBeAny()
        expectTypeOf(ctx.supabase).not.toBeAny()
        return Response.json({ ok: true })
      },
    )
    void _handler
  })

  it('an entry keyed on a Supabase-provided key fails to compile', () => {
    // withClaims contributes 'jwtClaims', which withSupabase already seeds.
    // Gating inside the array is redundant; the collision is a type error.
    // (Same property the SDK-1614 gate relies on.)
    // @ts-expect-error — Conflict<'jwtClaims'>: key already on the context
    const _bad = withSupabase(
      { auth: 'none', env: baseEnv, middleware: [withClaims()] },
      async () => Response.json({ ok: true }),
    )
    void _bad
  })

  it('sibling ordering: provider before dependent compiles', () => {
    const _ok = withSupabase(
      {
        auth: 'none',
        env: baseEnv,
        middleware: [withProvider(), withNeedsProv()],
      },
      async (_req, ctx) => {
        expectTypeOf(ctx.dep).toEqualTypeOf<{ ok: true }>()
        expectTypeOf(ctx.prov).toEqualTypeOf<{ v: number }>()
        return Response.json({ ok: true })
      },
    )
    void _ok
  })

  it('sibling ordering: dependent before provider fails to compile', () => {
    // @ts-expect-error — prereq 'prov' is not yet on the context
    const _bad = withSupabase(
      {
        auth: 'none',
        env: baseEnv,
        middleware: [withNeedsProv(), withProvider()],
      },
      async () => Response.json({ ok: true }),
    )
    void _bad
  })

  it('a prerequisite nothing supplies fails to compile', () => {
    // @ts-expect-error — prereq 'prov' is not on the context
    const _bad = withSupabase(
      { auth: 'none', env: baseEnv, middleware: [withNeedsProv()] },
      async () => Response.json({ ok: true }),
    )
    void _bad
  })

  it('nested: Base flows in beside a middleware array', () => {
    // The `satisfies FetchHandler` anchor is what pushes the upstream
    // contribution into `Base`; the validation conditional on the handler
    // parameter must not resolve the call before that happens.
    const _composed = withOAuthProtectedResource(
      withSupabase(
        { auth: 'none', env: baseEnv, middleware: [withProvider()] },
        async (_req, ctx) => {
          expectTypeOf(
            ctx.oauthProtectedResource.resourceMetadataUrl,
          ).toEqualTypeOf<string>()
          expectTypeOf(ctx.prov).toEqualTypeOf<{ v: number }>()
          expectTypeOf(ctx.supabase).not.toBeAny()
          return Response.json({ ok: true })
        },
      ),
    ) satisfies FetchHandler
    void _composed
  })

  it('a widened entry poisons validation for later typed entries', () => {
    // A hand-wrapped entry types as Entry<string, object, unknown>. Its
    // string key folds an index signature into the accumulated context, so
    // every later typed key reports a false conflict. Pinned here so the
    // failure mode is documented rather than discovered in consumer code.
    const widened = ((h) => h) as Entry<string, object, unknown>

    // @ts-expect-error — false Conflict<'prov'> caused by the widened entry
    const _bad = withSupabase(
      { auth: 'none', env: baseEnv, middleware: [widened, withProvider()] },
      async () => Response.json({ ok: true }),
    )
    void _bad

    // Placed last, a widened entry has nothing after it to poison.
    const _last = withSupabase(
      { auth: 'none', env: baseEnv, middleware: [withProvider(), widened] },
      async (_req, ctx) => {
        expectTypeOf(ctx.prov).toEqualTypeOf<{ v: number }>()
        return Response.json({ ok: true })
      },
    )
    void _last
  })

  it('explicit Database defaults Entries; array accepted, unvalidated', () => {
    const _handler = withSupabase<{ fixture: true }>(
      { auth: 'none', env: baseEnv, middleware: [withProvider()] },
      async (_req, ctx) => {
        expectTypeOf(ctx.supabase).not.toBeAny()
        // Entries defaulted to readonly AnyEntry[]: no tuple inference, so
        // contributions are not accumulated onto ctx.
        // @ts-expect-error — 'prov' is not on ctx without tuple inference
        void ctx.prov
        return Response.json({ ok: true })
      },
    )
    void _handler
  })
})
