import type { SupabaseClient } from '@supabase/supabase-js'
import { pipeline } from '@supabase/middleware'
import type { FetchHandler } from '@supabase/middleware'
import { describe, expect, it } from 'vitest'

import {
  buildClientInfo,
  detectMiddlewareTags,
  VIA,
  withMiddlewareTags,
} from './core/client-info.js'
import { createAdminClient } from './core/create-admin-client.js'
import { createContextClient } from './core/create-context-client.js'
import { withSupabaseAdminClient } from './middleware/admin-client/index.js'
import { withSupabaseClient } from './middleware/client/index.js'
import { withOAuthProtectedResource } from './oauth-protected-resource/with-oauth-protected-resource.js'
import { version } from './version.js'
import { withSupabase } from './with-supabase.js'

const env = {
  url: 'https://test.supabase.co',
  publishableKeys: { default: 'sb_publishable_xyz' },
  secretKeys: { default: 'sb_secret_xyz' },
  jwks: null,
}
const oauthCfg = {
  resourceServer: 'http://localhost/functions/v1/mcp',
  authorizationServer: 'https://test.supabase.co/auth/v1',
}
const VIA_TAG = `via=supabase-server/${version}`

function recorder() {
  const seen: (string | null)[] = []
  const fetch = (async (_input: unknown, init?: { headers?: HeadersInit }) => {
    seen.push(new Headers(init?.headers).get('x-client-info'))
    return new Response('[]', {
      status: 200,
      headers: { 'content-type': 'application/json' },
    })
  }) as unknown as typeof globalThis.fetch
  return { seen, supabaseOptions: { global: { fetch } } }
}

const metadata = (header: string | null, key: string) =>
  header
    ?.split(';')
    .slice(1)
    .filter((segment) => segment.split('=')[0].trim().toLowerCase() === key)
    .map((segment) => segment.slice(segment.indexOf('=') + 1).trim()) ?? []

function expectServerMetadata(header: string | null, middleware?: string) {
  expect(metadata(header, 'via')).toEqual([`supabase-server/${version}`])
  expect(metadata(header, 'middleware')).toEqual(middleware ? [middleware] : [])
}

describe('client-info helpers', () => {
  it('uses supabase-server/<version> as the default via', () => {
    expect(VIA).toBe(`supabase-server/${version}`)
    expect(buildClientInfo()).toEqual({ via: VIA })
    expect(buildClientInfo({})).toEqual({ via: VIA })
  })

  it('lets the caller override via', () => {
    expect(
      buildClientInfo({ global: { clientInfo: { via: 'my-lib/1.0.0' } } }),
    ).toEqual({ via: 'my-lib/1.0.0' })
  })

  it('detects only allowlisted upstream keys', () => {
    expect(detectMiddlewareTags(undefined)).toEqual([])
    expect(detectMiddlewareTags({})).toEqual([])
    expect(
      detectMiddlewareTags({ jwtClaims: {}, supabaseCors: true, mine: 1 }),
    ).toEqual([])
    expect(detectMiddlewareTags({ oauthProtectedResource: {} })).toEqual([
      'oauth-protected-resource',
    ])
  })

  it('leaves the options untouched when nothing is detected', () => {
    const options = { global: { clientInfo: { middleware: 'b,a,a' } } }
    expect(withMiddlewareTags(options, [])).toBe(options)
    expect(withMiddlewareTags(undefined, [])).toBeUndefined()
  })

  it('merges, sorts and deduplicates caller tokens with detected ones', () => {
    const options = {
      global: { clientInfo: { middleware: 'zeta, oauth-protected-resource' } },
    }
    const out = withMiddlewareTags(options, ['oauth-protected-resource'])
    expect(out?.global?.clientInfo).toEqual({
      middleware: 'oauth-protected-resource,zeta',
    })
    expect(options.global.clientInfo.middleware).toBe(
      'zeta, oauth-protected-resource',
    )
  })
})

describe('primitives', () => {
  it('createContextClient sends the versioned via', async () => {
    const { seen, supabaseOptions } = recorder()
    await createContextClient({ env, supabaseOptions }).from('t').select()
    expect(seen).toHaveLength(1)
    expectServerMetadata(seen[0])
  })

  it('createAdminClient sends the versioned via', async () => {
    const { seen, supabaseOptions } = recorder()
    await createAdminClient({ env, supabaseOptions }).from('t').select()
    expect(seen).toHaveLength(1)
    expectServerMetadata(seen[0])
  })

  it.each([
    ['createContextClient', createContextClient, 'via'],
    ['createContextClient', createContextClient, 'VIA'],
    ['createAdminClient', createAdminClient, 'via'],
    ['createAdminClient', createAdminClient, 'VIA'],
  ] as const)('%s: an explicit caller via wins (%#)', async (_n, make, key) => {
    const { seen, supabaseOptions } = recorder()
    const client = make({
      env,
      supabaseOptions: {
        global: {
          ...supabaseOptions.global,
          clientInfo: { [key]: 'my-lib/9.9.9' },
        },
      },
    })
    await client.from('t').select()
    expect(seen).toHaveLength(1)
    expect(metadata(seen[0], 'via')).toEqual(['my-lib/9.9.9'])
  })
})

describe.each([
  ['createContextClient', createContextClient],
  ['createAdminClient', createAdminClient],
] as const)('%s custom metadata', (_name, make) => {
  it('forwards generic custom metadata alongside via', async () => {
    const rec = recorder()
    await make({
      env,
      supabaseOptions: {
        global: {
          ...rec.supabaseOptions.global,
          clientInfo: { Custom_key: 'value' },
        },
      },
    })
      .from('t')
      .select()
    expect(rec.seen).toHaveLength(1)
    expect(rec.seen[0]).toContain(`; ${VIA_TAG}; Custom_key=value`)
  })
})

describe('middleware tags, end to end', () => {
  const run = async (handler: FetchHandler) =>
    handler(new Request('http://localhost/functions/v1/mcp'))

  const useBoth = async (
    _req: Request,
    ctx: {
      supabase: SupabaseClient
      supabaseAdmin: SupabaseClient
    },
  ) => {
    await ctx.supabase.from('t').select()
    await ctx.supabaseAdmin.from('t').select()
    return Response.json({ ok: true })
  }

  describe('pipeline', () => {
    const entries = (rec: ReturnType<typeof recorder>) =>
      [
        withSupabaseClient({ env, supabaseOptions: rec.supabaseOptions }),
        withSupabaseAdminClient({ env, supabaseOptions: rec.supabaseOptions }),
      ] as const

    it('OAuth upstream: user and lazy admin clients carry one oauth tag', async () => {
      const rec = recorder()
      const handler = pipeline(
        [withOAuthProtectedResource(oauthCfg), ...entries(rec)] as const,
        (req, ctx) => useBoth(req, ctx),
      )
      expect((await run(handler)).status).toBe(200)
      expect(rec.seen).toHaveLength(2)
      for (const header of rec.seen) {
        expectServerMetadata(header, 'oauth-protected-resource')
      }
    })

    it('OAuth downstream: not visible, so no middleware key', async () => {
      const rec = recorder()
      const handler = pipeline(
        [...entries(rec), withOAuthProtectedResource(oauthCfg)] as const,
        (req, ctx) => useBoth(req, ctx),
      )
      await run(handler)
      expect(rec.seen).toHaveLength(2)
      for (const header of rec.seen) {
        expectServerMetadata(header)
      }
    })

    it('OAuth absent: via only', async () => {
      const rec = recorder()
      const handler = pipeline(entries(rec), useBoth)
      await run(handler)
      expect(rec.seen).toHaveLength(2)
      for (const header of rec.seen) expectServerMetadata(header)
    })

    it.each(['middleware', 'Middleware'])(
      'merges caller %s tokens with the detected tag',
      async (key) => {
        const rec = recorder()
        const supabaseOptions = {
          global: {
            ...rec.supabaseOptions.global,
            clientInfo: { [key]: 'zeta,oauth-protected-resource' },
          },
        }
        const handler = pipeline(
          [
            withOAuthProtectedResource(oauthCfg),
            withSupabaseClient({ env, supabaseOptions }),
            withSupabaseAdminClient({ env, supabaseOptions }),
          ] as const,
          (req, ctx) => useBoth(req, ctx),
        )
        await run(handler)
        expect(rec.seen).toHaveLength(2)
        for (const header of rec.seen) {
          expectServerMetadata(header, 'oauth-protected-resource,zeta')
        }
      },
    )

    it('keeps caller-supplied tokens as they are when nothing is detected', async () => {
      const rec = recorder()
      const handler = pipeline(
        [
          withSupabaseClient({
            env,
            supabaseOptions: {
              global: {
                ...rec.supabaseOptions.global,
                clientInfo: { middleware: 'custom' },
              },
            },
          }),
        ] as const,
        async (_req, ctx) => {
          await ctx.supabase.from('t').select()
          return Response.json({})
        },
      )
      await run(handler)
      expect(rec.seen).toHaveLength(1)
      expectServerMetadata(rec.seen[0], 'custom')
    })
  })

  describe('withSupabase', () => {
    it('control: withSupabase alone carries via and no middleware key', async () => {
      const rec = recorder()
      const handler = withSupabase(
        { auth: 'none', env, supabaseOptions: rec.supabaseOptions },
        (req, ctx) => useBoth(req, ctx),
      )
      expect((await run(handler)).status).toBe(200)
      expect(rec.seen).toHaveLength(2)
      for (const header of rec.seen) expectServerMetadata(header)
    })

    it('nested, OAuth first: both clients carry the oauth tag', async () => {
      const rec = recorder()
      const handler = withOAuthProtectedResource(
        oauthCfg,
        withSupabase(
          { auth: 'none', env, supabaseOptions: rec.supabaseOptions },
          (req, ctx) => useBoth(req, ctx),
        ),
      )
      expect((await run(handler)).status).toBe(200)
      expect(rec.seen).toHaveLength(2)
      for (const header of rec.seen) {
        expectServerMetadata(header, 'oauth-protected-resource')
      }
    })

    it('pipeline, OAuth first: both clients carry the oauth tag', async () => {
      const rec = recorder()
      const handler = pipeline(
        [
          withOAuthProtectedResource(oauthCfg),
          withSupabase({
            auth: 'none',
            env,
            supabaseOptions: rec.supabaseOptions,
          }),
        ] as const,
        (req, ctx) => useBoth(req, ctx),
      )
      expect((await run(handler)).status).toBe(200)
      expect(rec.seen).toHaveLength(2)
      for (const header of rec.seen) {
        expectServerMetadata(header, 'oauth-protected-resource')
      }
    })

    it('pipeline, OAuth after withSupabase: not visible, no middleware key', async () => {
      const rec = recorder()
      const handler = pipeline(
        [
          withSupabase({
            auth: 'none',
            env,
            supabaseOptions: rec.supabaseOptions,
          }),
          withOAuthProtectedResource(oauthCfg),
        ] as const,
        (req, ctx) => useBoth(req, ctx),
      )
      await run(handler)
      expect(rec.seen).toHaveLength(2)
      for (const header of rec.seen) expectServerMetadata(header)
    })
  })
})

describe('telemetry preparation errors', () => {
  const supabaseOptions = {
    global: { clientInfo: { middleware: 42 as unknown as string } },
  }

  it('maps user client preparation failures to a construction error response', async () => {
    const handler = withOAuthProtectedResource(
      oauthCfg,
      withSupabase({ auth: 'none', env, supabaseOptions }, async () =>
        Response.json({ ok: true }),
      ),
    )
    const response = await handler(new Request('http://localhost/mcp'))
    expect(response.status).toBe(500)
    expect(response.headers.get('x-supabase-server-error')).toBe(
      'CREATE_SUPABASE_CLIENT_ERROR',
    )
  })

  it('defers admin preparation failures until first access and wraps their cause', async () => {
    let accessAdmin = false
    const handler = pipeline(
      [
        withOAuthProtectedResource(oauthCfg),
        withSupabaseAdminClient({ env, supabaseOptions }),
      ] as const,
      async (_req, ctx) => {
        if (accessAdmin) ctx.supabaseAdmin.from('t')
        return Response.json({ ok: true })
      },
    )
    expect((await handler(new Request('http://localhost/mcp'))).status).toBe(
      200,
    )
    accessAdmin = true
    await expect(
      handler(new Request('http://localhost/mcp')),
    ).rejects.toMatchObject({
      code: 'CREATE_SUPABASE_CLIENT_ERROR',
      cause: expect.any(TypeError),
    })
  })
})

describe('callers that already set X-Client-Info', () => {
  it.each([
    ['createContextClient', createContextClient],
    ['createAdminClient', createAdminClient],
  ])(
    '%s: a via already in the caller header is kept once, with no error',
    async (_n, make) => {
      const { seen, supabaseOptions } = recorder()
      const client = make({
        env,
        supabaseOptions: {
          global: {
            ...supabaseOptions.global,
            headers: { 'X-Client-Info': 'my-lib/1.0.0; via=mine' },
          },
        },
      })
      await client.from('t').select()
      expect(seen).toHaveLength(1)
      expect(seen[0]).toBe('my-lib/1.0.0; via=mine')
    },
  )

  it.each(['X-Client-Info', 'x-client-info'])(
    'merges OAuth into an existing %s middleware segment for both clients',
    async (name) => {
      const rec = recorder()
      const supabaseOptions = {
        global: {
          ...rec.supabaseOptions.global,
          headers: {
            [name]: 'opaque-client/9; custom=100%; MiDdLeWaRe=mine,mine',
          },
        },
      }
      const handler = pipeline(
        [
          withOAuthProtectedResource(oauthCfg),
          withSupabaseClient({ env, supabaseOptions }),
          withSupabaseAdminClient({ env, supabaseOptions }),
        ] as const,
        async (_r, ctx) => {
          await ctx.supabase.from('t').select()
          await ctx.supabaseAdmin.from('t').select()
          return Response.json({})
        },
      )
      expect((await handler(new Request('http://localhost/x'))).status).toBe(
        200,
      )
      expect(rec.seen).toHaveLength(2)
      for (const header of rec.seen) {
        expect(header).toBe(
          `opaque-client/9; custom=100%; middleware=mine,oauth-protected-resource; ${VIA_TAG}`,
        )
      }
      expect(supabaseOptions.global.headers[name]).toBe(
        'opaque-client/9; custom=100%; MiDdLeWaRe=mine,mine',
      )
    },
  )
})
