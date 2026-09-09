import { beforeEach, describe, expect, expectTypeOf, it, vi } from 'vitest'
import { defineMiddleware, getEnv, pipeline } from '@supabase/middleware'
import type { FetchHandler } from '@supabase/middleware'

import { _resetAllowDeprecationWarned } from './core/utils/deprecation.js'
import { createSupabaseContext } from './create-supabase-context.js'
import {
  EnvError,
  ErrorCodeHeader,
  JwksNotConfiguredError,
  MissingCredentialsError,
  MissingDefaultSecretKeyError,
} from './errors.js'
import type { JWTClaims, SupabaseContext, WithSupabaseConfig } from './types.js'
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
      { auth: 'none', env: baseEnv },
      withReadEnv(async (_req, ctx) =>
        Response.json({ bindingValue: ctx.bindingValue }),
      ),
    )

    // Workers-style invocation: fetch(request, env).
    const res = await handler(new Request('http://localhost'), {
      WITH_SUPABASE_TEST_BINDING: 'from-platform',
    })
    expect(await res.json()).toEqual({ bindingValue: 'from-platform' })
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
  it('as a pipeline entry, supplies jwtClaims to withPostgresClient', () => {
    const _handler = pipeline(
      [
        withSupabase({ auth: 'user', env: baseEnv }),
        withPostgresClient({ connectionString: 'postgres://x' }),
      ],
      async (_req, ctx) => {
        expectTypeOf(ctx.postgres).not.toBeAny()
        expectTypeOf(ctx.supabase).not.toBeAny()
        return Response.json({ ok: true })
      },
    )
    void _handler
  })

  it('an entry keyed on a Supabase-provided key fails to compile after withSupabase', () => {
    const _handler = pipeline(
      [withSupabase({ auth: 'none', env: baseEnv }), withClaims()],
      // @ts-expect-error — Conflict<'jwtClaims'>: withSupabase already contributes it
      async () => Response.json({ ok: true }),
    )
    void _handler
  })

  it('nested: Base flows in from an outer middleware', () => {
    const _composed = withOAuthProtectedResource(
      withSupabase({ auth: 'none', env: baseEnv }, async (_req, ctx) => {
        expectTypeOf(
          ctx.oauthProtectedResource.resourceMetadataUrl,
        ).toEqualTypeOf<string>()
        expectTypeOf(ctx.supabase).not.toBeAny()
        return Response.json({ ok: true })
      }),
    ) satisfies FetchHandler
    void _composed
  })

  it('accepts a pre-annotated handler, as the ui-library mcp-server block does', () => {
    async function handleMcp(
      _request: Request,
      ctx: SupabaseContext,
    ): Promise<Response> {
      return Response.json({ id: ctx.userClaims?.id ?? null })
    }
    const _composed = withOAuthProtectedResource(
      withSupabase(
        {
          auth: 'user',
          env: baseEnv,
          cors: { headers: { 'Access-Control-Allow-Origin': '*' } },
        },
        handleMcp,
      ),
    )
    void _composed
  })

  it('explicit Database types the client', () => {
    const _handler = withSupabase<{ fixture: true }>(
      { auth: 'none', env: baseEnv },
      async (_req, ctx) => {
        expectTypeOf(ctx.supabase).not.toBeAny()
        return Response.json({ ok: true })
      },
    )
    void _handler
  })

  it('nested: a middleware with a prerequisite composes as the handler', () => {
    const _handler = withSupabase(
      { auth: 'user', env: baseEnv },
      withPostgresClient(
        { connectionString: 'postgres://x' },
        async (_req, ctx) => {
          expectTypeOf(ctx.postgres).not.toBeAny()
          expectTypeOf(ctx.supabase).not.toBeAny()
          return Response.json({ ok: true })
        },
      ),
    )
    void _handler
  })
})

describe('withSupabase as a pipeline entry', () => {
  const oauthCfg = {
    resourceServer: 'http://localhost/functions/v1/mcp',
    authorizationServer: 'https://test.supabase.co/auth/v1',
  }
  const mcp = () =>
    pipeline(
      [
        withOAuthProtectedResource(oauthCfg),
        withSupabase({ auth: 'user', env: baseEnv }),
      ],
      async () => new Response('handler ran'),
    )

  it('returns an entry when called with config only', () => {
    expect(typeof withSupabase({ auth: 'none', env: baseEnv })).toBe('function')
  })

  it('serves OAuth discovery ahead of the auth gate', async () => {
    const res = await mcp()(
      new Request('http://localhost/functions/v1/mcp/oauth-protected-resource'),
    )
    expect(res.status).toBe(200)
    expect((await res.json()).authorization_servers).toEqual([
      'https://test.supabase.co/auth/v1',
    ])
  })

  it('enriches the gate 401 with WWW-Authenticate', async () => {
    const res = await mcp()(
      new Request('http://localhost/functions/v1/mcp', { method: 'POST' }),
    )
    expect(res.status).toBe(401)
    expect(res.headers.get('WWW-Authenticate')).toBe(
      'Bearer resource_metadata="http://localhost/functions/v1/mcp/oauth-protected-resource"',
    )
  })

  it('lets the OAuth middleware answer the metadata preflight', async () => {
    const res = await mcp()(
      new Request(
        'http://localhost/functions/v1/mcp/oauth-protected-resource',
        {
          method: 'OPTIONS',
        },
      ),
    )
    expect(res.status).toBe(204)
    expect(res.headers.get('Access-Control-Allow-Headers')).toContain(
      'mcp-protocol-version',
    )
  })

  it('supplies jwtClaims to an entry placed after it', async () => {
    const withCaller = defineMiddleware<
      'caller',
      void,
      { jwtClaims: JWTClaims | null },
      string
    >({
      key: 'caller',
      run: () => async (_req, ctx) => ({
        caller: ctx.jwtClaims?.sub ?? 'anon',
      }),
    })
    const handler = pipeline(
      [withSupabase({ auth: 'none', env: baseEnv }), withCaller()],
      async (_req, ctx) =>
        Response.json({ caller: ctx.caller, authMode: ctx.authMode }),
    )
    expect(
      await (await handler(new Request('http://localhost'))).json(),
    ).toEqual({
      caller: 'anon',
      authMode: 'none',
    })
  })

  it('stamps CORS headers and exposes the error code on the gate 401', async () => {
    const handler = pipeline(
      [withSupabase({ auth: 'user', env: baseEnv })],
      async () => new Response('handler ran'),
    )
    const res = await handler(new Request('http://localhost'))
    expect(res.status).toBe(401)
    expect(res.headers.get('Access-Control-Allow-Origin')).toBe('*')
    expect(res.headers.get('Access-Control-Expose-Headers')).toBe(
      ErrorCodeHeader,
    )
  })

  it('answers OPTIONS with 204 before the gate', async () => {
    const handler = pipeline(
      [withSupabase({ auth: 'user', env: baseEnv })],
      async () => new Response('handler ran'),
    )
    const res = await handler(
      new Request('http://localhost', { method: 'OPTIONS' }),
    )
    expect(res.status).toBe(204)
    expect(res.headers.get('Access-Control-Allow-Origin')).toBe('*')
  })

  it('stamps CORS headers on a success response when an entry follows it', async () => {
    const withNoop = defineMiddleware<'noop', void, Record<never, never>, true>(
      {
        key: 'noop',
        run: () => async () => ({ noop: true as const }),
      },
    )
    const handler = pipeline(
      [withSupabase({ auth: 'none', env: baseEnv }), withNoop()],
      async () => Response.json({ ok: true }),
    )
    const res = await handler(new Request('http://localhost'))
    expect(res.status).toBe(200)
    expect(res.headers.get('Access-Control-Allow-Origin')).toBe('*')
  })
})

describe('withSupabase context shape', () => {
  it('exposes exactly the documented keys and no internal plumbing', async () => {
    const handler = withSupabase(
      { auth: 'none', env: baseEnv },
      async (_req, ctx) => {
        // @ts-expect-error — internal to the composite
        void ctx.supabaseAuth
        // @ts-expect-error — internal to the composite
        void ctx.supabaseCors
        return Response.json({ keys: Object.keys(ctx).sort() })
      },
    )
    const body = await (await handler(new Request('http://localhost'))).json()
    expect(body.keys).toEqual([
      'authKeyName',
      'authMode',
      'jwtClaims',
      'supabase',
      'supabaseAdmin',
      'userClaims',
    ])
  })

  it('buffers the request at the entry so a nested middleware and the handler can both read the body', async () => {
    const withPeek = defineMiddleware<
      'peek',
      void,
      Record<never, never>,
      string
    >({
      key: 'peek',
      run: () => async (req) => ({ peek: await req.text() }),
    })
    const handler = withSupabase(
      { auth: 'none', env: baseEnv },
      withPeek(async (req, ctx) =>
        Response.json({ peek: ctx.peek, again: await req.text() }),
      ),
    )
    const res = await handler(
      new Request('http://localhost', { method: 'POST', body: 'hello' }),
    )
    expect(await res.json()).toEqual({ peek: 'hello', again: 'hello' })
  })
})

describe('withSupabase key mirroring', () => {
  it('the client is built with the named key the request matched', async () => {
    const handler = withSupabase(
      {
        auth: 'publishable:web',
        env: {
          ...baseEnv,
          publishableKeys: {
            default: 'sb_publishable_xyz',
            web: 'sb_publishable_web',
          },
        },
      },
      async (_req, ctx) => {
        expect(ctx.authKeyName).toBe('web')
        expect(
          (ctx.supabase as unknown as { supabaseKey: string }).supabaseKey,
        ).toBe('sb_publishable_web')
        return Response.json({ ok: true })
      },
    )

    const req = new Request('http://localhost', {
      headers: { apikey: 'sb_publishable_web' },
    })
    const res = await handler(req)
    expect(res.status).toBe(200)
  })
})

describe('pre-auth middleware placement', () => {
  const oauthCfg = {
    resourceServer: 'http://localhost/functions/v1/mcp',
    authorizationServer: 'https://test.supabase.co/auth/v1',
  }
  const ok = async () => new Response('ok')

  it('refuses a pipeline that places withOAuthProtectedResource after a credentialed gate', () => {
    expect(() =>
      pipeline(
        [
          withSupabase({ auth: 'user', env: baseEnv }),
          withOAuthProtectedResource(oauthCfg),
        ],
        ok,
      ),
    ).toThrow(/withOAuthProtectedResource is placed after withSupabase/)
  })

  it('refuses the nested form as well', () => {
    expect(() =>
      withSupabase(
        { auth: 'user', env: baseEnv },
        withOAuthProtectedResource(oauthCfg, ok),
      ),
    ).toThrow(/placed after withSupabase/)
  })

  it("accepts the placement when the gate admits anonymous requests (auth: 'none')", async () => {
    const handler = pipeline(
      [
        withSupabase({ auth: 'none', env: baseEnv }),
        withOAuthProtectedResource(oauthCfg),
      ],
      ok,
    )
    const res = await handler(
      new Request('http://localhost/functions/v1/mcp/oauth-protected-resource'),
    )
    expect(res.status).toBe(200)
  })

  it("accepts the placement when 'none' is one of several modes", () => {
    expect(() =>
      pipeline(
        [
          withSupabase({ auth: ['user', 'none'], env: baseEnv }),
          withOAuthProtectedResource(oauthCfg),
        ],
        ok,
      ),
    ).not.toThrow()
  })

  it('accepts the correct order and the wrap form', () => {
    expect(() =>
      pipeline(
        [
          withOAuthProtectedResource(oauthCfg),
          withSupabase({ auth: 'user', env: baseEnv }),
        ],
        ok,
      ),
    ).not.toThrow()
    expect(() =>
      withOAuthProtectedResource(
        oauthCfg,
        withSupabase({ auth: 'user', env: baseEnv }, ok),
      ),
    ).not.toThrow()
  })
})

describe('withSupabase config without a middleware option', () => {
  it('refuses a config carrying a middleware key, even when built outside the call', () => {
    const config = {
      auth: 'none',
      env: baseEnv,
      middleware: [],
    } as unknown as WithSupabaseConfig
    expect(() => withSupabase(config, async () => new Response('ok'))).toThrow(
      /has no `middleware` option/,
    )
  })
})
