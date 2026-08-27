import { createServer } from 'node:http'
import type { AddressInfo } from 'node:net'

import { afterEach, describe, expect, it, vi } from 'vitest'
import { pipeline } from '@supabase/middleware'

import {
  EnvError,
  MissingAuthorizationServerError,
  MissingResourceServerError,
} from '../errors.js'
import { resourceMetadataResponse, unauthorizedResponse } from './responses.js'
import { isEdgeFunctions } from './runtime.js'
import { fromSupabaseUrl } from './url.js'
import { withOAuthProtectedResource } from './with-oauth-protected-resource.js'

// Defaults to Edge Functions; `offEdgeFunctions()` flips it per test. Mocking
// the predicate rather than setting `SUPABASE_FUNCTION_SLUG` keeps the slug out
// of `edgeResourcePath`, whose no-slug branch the path tests exercise.
vi.mock('./runtime.js', () => ({ isEdgeFunctions: vi.fn(() => true) }))

const edgeFunctionsCheck = vi.mocked(isEdgeFunctions)

function offEdgeFunctions() {
  edgeFunctionsCheck.mockReturnValue(false)
}

afterEach(() => {
  edgeFunctionsCheck.mockReturnValue(true)
})

const req = (method: string, path: string, headers?: Record<string, string>) =>
  new Request(`http://localhost${path}`, { method, headers })

const passthrough = async () => new Response('ok', { status: 200 })
const returns401 = async () =>
  new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401 })

/** Set env vars for one test, restoring prior values afterward. */
const testEnv = (
  globalThis as { process?: { env: Record<string, string | undefined> } }
).process!.env
const envCleanup: Array<() => void> = []
function setEnv(name: string, value: string | undefined) {
  const prior = testEnv[name]
  if (value === undefined) delete testEnv[name]
  else testEnv[name] = value
  envCleanup.push(() => {
    if (prior === undefined) delete testEnv[name]
    else testEnv[name] = prior
  })
}
afterEach(() => {
  while (envCleanup.length) envCleanup.pop()!()
})

describe('withOAuthProtectedResource - metadata route', () => {
  it('serves RFC 9728 JSON on GET /fn/oauth-protected-resource', async () => {
    const res = await withOAuthProtectedResource(passthrough)(
      req('GET', '/my-fn/oauth-protected-resource'),
    )
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body).toHaveProperty('resource')
    expect(body).toHaveProperty('authorization_servers')
    expect(body.bearer_methods_supported).toContain('header')
  })

  it('passes POST to /fn/oauth-protected-resource through to the inner handler', async () => {
    // Only GET matches the metadata route; every other method (and path) falls
    // through to the inner handler rather than 404ing — see the path-routing
    // describe block below.
    const res = await withOAuthProtectedResource(passthrough)(
      req('POST', '/my-fn/oauth-protected-resource'),
    )
    expect(res.status).toBe(200)
  })
})

describe('withOAuthProtectedResource - method pass-through', () => {
  it('passes POST through to inner handler', async () => {
    const res = await withOAuthProtectedResource(passthrough)(
      req('POST', '/my-fn'),
    )
    expect(res.status).toBe(200)
  })

  it('passes OPTIONS through to inner handler (CORS preflight)', async () => {
    const handler = async () => new Response(null, { status: 204 })
    const res = await withOAuthProtectedResource(handler)(
      req('OPTIONS', '/my-fn'),
    )
    expect(res.status).toBe(204)
  })

  it("passes GET, DELETE, and other methods through unchanged (method routing is the terminal handler's job)", async () => {
    for (const method of ['GET', 'DELETE', 'PUT', 'PATCH', 'HEAD']) {
      const res = await withOAuthProtectedResource(passthrough)(
        req(method, '/my-fn'),
      )
      expect(res.status).toBe(200)
    }
  })

  it('returns 401 + WWW-Authenticate for unauthenticated non-POST (auth discovery before any method check)', async () => {
    for (const method of ['GET', 'DELETE', 'PUT']) {
      const res = await withOAuthProtectedResource(returns401)(
        req(method, '/my-fn'),
      )
      expect(res.status).toBe(401)
      expect(res.headers.get('WWW-Authenticate')).toMatch(/resource_metadata=/)
    }
  })
})

describe('withOAuthProtectedResource - path routing', () => {
  it('passes unrecognized sub-paths through to the inner handler (deliberate: AI-995)', async () => {
    // Was a blanket 404 under the old hand-written closure — an accidental
    // side effect of being a standalone wrapper, not a deliberate contract.
    // The defineMiddleware conversion passes through instead, since that's
    // what fits the composition model: routing is the inner handler's job.
    const res = await withOAuthProtectedResource(passthrough)(
      req('POST', '/my-fn/something'),
    )
    expect(res.status).toBe(200)
  })

  it('includes the function path segment in the advertised resource', async () => {
    const res = await withOAuthProtectedResource(passthrough)(
      req('GET', '/my-function/oauth-protected-resource'),
    )
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(String(body.resource)).toContain('my-function')
  })

  it('includes /functions/v1/ prefix in resource metadata URL', async () => {
    const res = await withOAuthProtectedResource(passthrough)(
      req('GET', '/my-fn/oauth-protected-resource'),
    )
    const body = await res.json()
    expect(String(body.resource)).toContain('/functions/v1/my-fn')
    expect(String(body.authorization_servers[0])).toContain('/auth/v1')
  })
})

describe('withOAuthProtectedResource - 401 enrichment', () => {
  it('adds WWW-Authenticate to 401 responses from inner handler', async () => {
    const res = await withOAuthProtectedResource(returns401)(
      req('POST', '/my-fn'),
    )
    expect(res.status).toBe(401)
    const wwwAuth = res.headers.get('WWW-Authenticate') ?? ''
    expect(wwwAuth).toMatch(/^Bearer /)
    expect(wwwAuth).toContain('resource_metadata=')
  })

  it('does not modify non-401 responses', async () => {
    const res = await withOAuthProtectedResource(passthrough)(
      req('POST', '/my-fn'),
    )
    expect(res.headers.get('WWW-Authenticate')).toBeNull()
  })

  it('preserves existing response body and headers on 401', async () => {
    const handler = async () =>
      new Response(JSON.stringify({ error: 'Unauthorized' }), {
        status: 401,
        headers: { 'Content-Type': 'application/json' },
      })
    const res = await withOAuthProtectedResource(handler)(req('POST', '/my-fn'))
    expect(res.headers.get('Content-Type')).toBe('application/json')
    const body = await res.json()
    expect(body.error).toBe('Unauthorized')
  })

  it('does not clobber a WWW-Authenticate the handler already set', async () => {
    const custom =
      'Bearer error="invalid_token", error_description="expired", resource_metadata="https://tenant.example.com/functions/v1/my-fn/oauth-protected-resource"'
    const handler = async () =>
      new Response(null, {
        status: 401,
        headers: { 'WWW-Authenticate': custom },
      })
    const res = await withOAuthProtectedResource(handler)(req('POST', '/my-fn'))
    expect(res.headers.get('WWW-Authenticate')).toBe(custom)
  })
})

describe('withOAuthProtectedResource - metadata CORS', () => {
  it('serves metadata with a permissive CORS header (public discovery data)', async () => {
    const res = await withOAuthProtectedResource(passthrough)(
      req('GET', '/my-fn/oauth-protected-resource'),
    )
    expect(res.headers.get('Access-Control-Allow-Origin')).toBe('*')
  })

  it('answers OPTIONS preflight on the metadata path', async () => {
    const res = await withOAuthProtectedResource(passthrough)(
      req('OPTIONS', '/my-fn/oauth-protected-resource'),
    )
    expect(res.status).toBe(204)
    expect(res.headers.get('Access-Control-Allow-Origin')).toBe('*')
    expect(res.headers.get('Access-Control-Allow-Methods')).toContain('GET')
  })
})

describe('resourceMetadataResponse', () => {
  it('returns 200 with RFC 9728 structure', async () => {
    const res = resourceMetadataResponse(
      req('GET', '/my-fn/oauth-protected-resource'),
    )
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.resource).toBeTruthy()
    expect(Array.isArray(body.authorization_servers)).toBe(true)
    expect(body.bearer_methods_supported).toContain('header')
  })

  it('accepts resource and authorizationServers overrides', async () => {
    const res = resourceMetadataResponse(
      req('GET', '/my-fn/oauth-protected-resource'),
      {
        resource: 'https://example.com/functions/v1/my-fn',
        authorizationServers: ['https://example.com/auth/v1'],
      },
    )
    const body = await res.json()
    expect(body.resource).toBe('https://example.com/functions/v1/my-fn')
    expect(body.authorization_servers).toEqual(['https://example.com/auth/v1'])
  })
})

describe('unauthorizedResponse', () => {
  it('returns 401 with WWW-Authenticate header', () => {
    const res = unauthorizedResponse(req('POST', '/my-fn'))
    expect(res.status).toBe(401)
    const wwwAuth = res.headers.get('WWW-Authenticate') ?? ''
    expect(wwwAuth).toMatch(/^Bearer /)
    expect(wwwAuth).toContain('resource_metadata=')
  })

  it('accepts a resourceMetadataUrl override', () => {
    const url =
      'https://example.com/functions/v1/my-fn/oauth-protected-resource'
    const res = unauthorizedResponse(req('POST', '/my-fn'), {
      resourceMetadataUrl: url,
    })
    expect(res.headers.get('WWW-Authenticate')).toBe(
      `Bearer resource_metadata="${url}"`,
    )
  })

  it('percent-encodes `"` in the resourceMetadataUrl override (quoted-string integrity)', () => {
    const res = unauthorizedResponse(req('POST', '/my-fn'), {
      resourceMetadataUrl: 'https://x.example.com/a"b/oauth-protected-resource',
    })
    expect(res.headers.get('WWW-Authenticate')).toBe(
      'Bearer resource_metadata="https://x.example.com/a%22b/oauth-protected-resource"',
    )
  })
})

describe('withOAuthProtectedResource - resourceServer / authorizationServer', () => {
  const offEdge = {
    resourceServer: (r: Request) => `${new URL(r.url).origin}/api/mcp`,
    authorizationServer: fromSupabaseUrl('https://ref.supabase.co'),
  }

  it('a request-derived resourceServer ignores X-Forwarded-* entirely', async () => {
    const res = await withOAuthProtectedResource(
      offEdge,
      passthrough,
    )(
      req('GET', '/api/mcp/oauth-protected-resource', {
        'X-Forwarded-Host': 'evil.example.com',
        'X-Forwarded-Proto': 'https',
      }),
    )
    const body = await res.json()
    expect(body.resource).toBe('http://localhost/api/mcp')
    expect(body.resource).not.toContain('evil.example.com')
    expect(body.resource).not.toContain('/functions/v1')
  })

  it('accepts a static string resourceServer', async () => {
    const res = await withOAuthProtectedResource(
      { resourceServer: 'https://api.example.com/mcp', ...{} },
      passthrough,
    )(req('GET', '/api/mcp/oauth-protected-resource'))
    const body = await res.json()
    expect(body.resource).toBe('https://api.example.com/mcp')
  })

  it('accepts any non-Supabase authorization server', async () => {
    const res = await withOAuthProtectedResource(
      {
        resourceServer: 'https://api.example.com/mcp',
        authorizationServer: 'https://example.clerk.accounts.dev',
      },
      passthrough,
    )(req('GET', '/api/mcp/oauth-protected-resource'))
    const body = await res.json()
    expect(body.authorization_servers).toEqual([
      'https://example.clerk.accounts.dev',
    ])
  })

  it('fromSupabaseUrl appends the Auth path, and tolerates it already being there', () => {
    expect(fromSupabaseUrl('https://ref.supabase.co')).toBe(
      'https://ref.supabase.co/auth/v1',
    )
    expect(fromSupabaseUrl('https://ref.supabase.co/')).toBe(
      'https://ref.supabase.co/auth/v1',
    )
    expect(fromSupabaseUrl('https://ref.supabase.co/auth/v1')).toBe(
      'https://ref.supabase.co/auth/v1',
    )
  })

  it('nested and pipeline forms produce identical metadata (Config union guard)', async () => {
    const nested = await withOAuthProtectedResource(
      offEdge,
      passthrough,
    )(req('GET', '/api/mcp/oauth-protected-resource'))
    const piped = await pipeline(
      [withOAuthProtectedResource(offEdge)],
      passthrough,
    )(req('GET', '/api/mcp/oauth-protected-resource'))
    expect(await nested.json()).toEqual(await piped.json())
  })

  it('config is optional — all three call forms still work', async () => {
    const res = await withOAuthProtectedResource(passthrough)(
      req('GET', '/my-fn/oauth-protected-resource'),
    )
    expect(res.status).toBe(200)
    const piped = await pipeline(
      [withOAuthProtectedResource()],
      passthrough,
    )(req('GET', '/my-fn/oauth-protected-resource'))
    expect(piped.status).toBe(200)
  })
})

describe('withOAuthProtectedResource - metadata URL matches the URL the client used', () => {
  // RFC 9728 §3.3: when metadata is fetched from a `WWW-Authenticate`
  // `resource_metadata` URL, the returned `resource` MUST be identical to the
  // URL the client used, or the client MUST NOT use the response. So
  // `resource + '/oauth-protected-resource'` has to equal the request URL for
  // every path the metadata route answers on.
  const invariantHolds = async (path: string) => {
    const res = await withOAuthProtectedResource(passthrough)(
      req('GET', path, { 'X-Forwarded-Host': 'app.example.com' }),
    )
    const body = await res.json()
    return `${body.resource}/oauth-protected-resource`
  }

  it('holds at the function root (edge default)', async () => {
    expect(await invariantHolds('/my-fn/oauth-protected-resource')).toBe(
      'http://app.example.com/functions/v1/my-fn/oauth-protected-resource',
    )
  })

  it('holds at a nested path (edge default)', async () => {
    // Regression: first-path-segment inference reported the top-level function
    // here, so resource + suffix != the URL the client used.
    expect(await invariantHolds('/my-fn/nested/oauth-protected-resource')).toBe(
      'http://app.example.com/functions/v1/my-fn/nested/oauth-protected-resource',
    )
  })

  it('holds at a nested path with a request-derived resourceServer', async () => {
    const res = await withOAuthProtectedResource(
      {
        resourceServer: (r) =>
          new URL(r.url).origin +
          new URL(r.url).pathname.replace(/\/oauth-protected-resource$/, ''),
      },
      passthrough,
    )(req('GET', '/api/deep/mcp/oauth-protected-resource'))
    const body = await res.json()
    expect(`${body.resource}/oauth-protected-resource`).toBe(
      'http://localhost/api/deep/mcp/oauth-protected-resource',
    )
  })

  it('SUPABASE_FUNCTION_SLUG yields a canonical identifier, whatever the path', async () => {
    setEnv('SUPABASE_PUBLIC_URL', undefined)
    setEnv('SUPABASE_FUNCTION_SLUG', 'my-fn')
    const canonical =
      'http://app.example.com/functions/v1/my-fn/oauth-protected-resource'
    // Stripped prefix, unstripped prefix, and a sub-path all agree.
    expect(await invariantHolds('/my-fn/oauth-protected-resource')).toBe(
      canonical,
    )
    expect(
      await invariantHolds('/functions/v1/my-fn/oauth-protected-resource'),
    ).toBe(canonical)
    expect(await invariantHolds('/my-fn/nested/oauth-protected-resource')).toBe(
      canonical,
    )
  })

  it('without the slug, a sub-path reports the sub-path', async () => {
    // The one real behavioral difference: path reconstruction reports whatever
    // path the request arrived on, where the canonical form reports the function.
    // Does not arise for MCP (Streamable HTTP is a single endpoint).
    setEnv('SUPABASE_PUBLIC_URL', undefined)
    setEnv('SUPABASE_FUNCTION_SLUG', undefined)
    expect(await invariantHolds('/my-fn/nested/oauth-protected-resource')).toBe(
      'http://app.example.com/functions/v1/my-fn/nested/oauth-protected-resource',
    )
  })

  it('holds for a function actually named "functions"', async () => {
    // Every gateway strips `/functions/v1`, so the prefix is restored
    // unconditionally. That keeps this case correct: sniffing for an existing
    // prefix would mistake the function's own name for the stripped prefix and
    // advertise `/functions/v1`, which the client would reject.
    setEnv('SUPABASE_PUBLIC_URL', undefined)
    expect(await invariantHolds('/functions/v1/oauth-protected-resource')).toBe(
      'http://app.example.com/functions/v1/functions/v1/oauth-protected-resource',
    )
  })
})

describe('withOAuthProtectedResource - authorization server resolution', () => {
  it('explicit authorizationServer wins over the derived default', async () => {
    const res = await withOAuthProtectedResource(
      { authorizationServer: fromSupabaseUrl('https://explicit.supabase.co') },
      passthrough,
    )(req('GET', '/my-fn/oauth-protected-resource'))
    const body = await res.json()
    expect(body.authorization_servers).toEqual([
      'https://explicit.supabase.co/auth/v1',
    ])
  })

  it('SUPABASE_URL never overrides the Edge-derived origin (internal-hostname regression)', async () => {
    // Self-hosted, SUPABASE_URL is the internal gateway host; on hosted with a
    // custom domain it is pinned to the ref domain. Neither must ever leak into
    // the advertised issuer — the forwarded headers are the source of truth.
    setEnv('SUPABASE_URL', 'http://kong:8000')
    setEnv('SUPABASE_PUBLIC_URL', undefined)
    const res = await withOAuthProtectedResource(passthrough)(
      req('GET', '/my-fn/oauth-protected-resource', {
        'X-Forwarded-Host': 'app.example.com',
        'X-Forwarded-Proto': 'https',
      }),
    )
    const body = await res.json()
    expect(body.authorization_servers).toEqual([
      'https://app.example.com/auth/v1',
    ])
    expect(String(body.authorization_servers[0])).not.toContain('kong')
  })

  it('falls back to SUPABASE_URL off Edge Functions, where no origin can be derived', async () => {
    offEdgeFunctions()
    setEnv('SUPABASE_URL', 'https://ref.supabase.co')
    setEnv('SUPABASE_PUBLIC_URL', undefined)
    const res = await withOAuthProtectedResource(
      { resourceServer: 'https://api.example.com/mcp' },
      passthrough,
    )(
      req('GET', '/api/mcp/oauth-protected-resource', {
        'X-Forwarded-Host': 'app.vercel.app',
        'X-Forwarded-Proto': 'https',
      }),
    )
    const body = await res.json()
    expect(body.authorization_servers).toEqual([
      'https://ref.supabase.co/auth/v1',
    ])
    expect(String(body.authorization_servers[0])).not.toContain('vercel')
  })

  it('derives the issuer from SUPABASE_PUBLIC_URL when set', async () => {
    setEnv('SUPABASE_PUBLIC_URL', 'https://public.example.com')
    const res = await withOAuthProtectedResource(passthrough)(
      req('GET', '/my-fn/oauth-protected-resource'),
    )
    const body = await res.json()
    expect(body.authorization_servers).toEqual([
      'https://public.example.com/auth/v1',
    ])
  })

  it('supports a per-request authorizationServer function', async () => {
    const res = await withOAuthProtectedResource(
      { authorizationServer: (r) => `${new URL(r.url).origin}/auth/v1` },
      passthrough,
    )(req('GET', '/my-fn/oauth-protected-resource'))
    const body = await res.json()
    expect(body.authorization_servers).toEqual(['http://localhost/auth/v1'])
  })
})

describe('edge default - SUPABASE_PUBLIC_URL + header bug fixes', () => {
  it('SUPABASE_PUBLIC_URL takes precedence over X-Forwarded-* headers', async () => {
    setEnv('SUPABASE_PUBLIC_URL', 'https://public.example.com')
    const res = await withOAuthProtectedResource(passthrough)(
      req('GET', '/my-fn/oauth-protected-resource', {
        'X-Forwarded-Host': 'header.example.com',
        'X-Forwarded-Proto': 'https',
      }),
    )
    const body = await res.json()
    expect(body.resource).toBe('https://public.example.com/functions/v1/my-fn')
  })

  it('falls back to header inference when SUPABASE_PUBLIC_URL is unset', async () => {
    setEnv('SUPABASE_PUBLIC_URL', undefined)
    const res = await withOAuthProtectedResource(passthrough)(
      req('GET', '/my-fn/oauth-protected-resource', {
        'X-Forwarded-Host': 'header.example.com',
        'X-Forwarded-Proto': 'https',
      }),
    )
    const body = await res.json()
    expect(body.resource).toBe('https://header.example.com/functions/v1/my-fn')
  })

  it('uses X-Forwarded-Host as-is (no gateway comma-joins it)', async () => {
    // Kong overwrites all three forwarded headers outright, the hosted relay
    // sets a single value, and Envoy sets one value per route — so a comma-joined
    // value means an unknown proxy. We use the raw value rather than guessing a
    // hop; the resulting origin fails RFC 9728 §3.3 visibly.
    setEnv('SUPABASE_PUBLIC_URL', undefined)
    const res = await withOAuthProtectedResource(passthrough)(
      req('GET', '/my-fn/oauth-protected-resource', {
        'X-Forwarded-Host': 'app.example.com',
        'X-Forwarded-Proto': 'https',
      }),
    )
    const body = await res.json()
    expect(body.resource).toBe('https://app.example.com/functions/v1/my-fn')
  })

  it('keeps a separately-forwarded port (Kong sends a bare host)', async () => {
    setEnv('SUPABASE_PUBLIC_URL', undefined)
    const res = await withOAuthProtectedResource(passthrough)(
      req('GET', '/my-fn/oauth-protected-resource', {
        'X-Forwarded-Host': '127.0.0.1',
        'X-Forwarded-Port': '54321',
        'X-Forwarded-Proto': 'http',
      }),
    )
    const body = await res.json()
    expect(body.resource).toBe('http://127.0.0.1:54321/functions/v1/my-fn')
  })

  it('does not append a second port when the forwarded host already has one', async () => {
    setEnv('SUPABASE_PUBLIC_URL', undefined)
    const res = await withOAuthProtectedResource(passthrough)(
      req('GET', '/my-fn/oauth-protected-resource', {
        'X-Forwarded-Host': 'app.example.com:8443',
        'X-Forwarded-Proto': 'https',
        'X-Forwarded-Port': '443',
      }),
    )
    const body = await res.json()
    expect(body.resource).toBe(
      'https://app.example.com:8443/functions/v1/my-fn',
    )
  })

  it('treats an uppercase X-Forwarded-Proto case-insensitively for standard-port handling', async () => {
    setEnv('SUPABASE_PUBLIC_URL', undefined)
    const res = await withOAuthProtectedResource(passthrough)(
      req('GET', '/my-fn/oauth-protected-resource', {
        'X-Forwarded-Host': 'app.example.com',
        'X-Forwarded-Proto': 'HTTPS',
        'X-Forwarded-Port': '443',
      }),
    )
    const body = await res.json()
    // 443 is standard for https → no port suffix, and proto lowercased.
    expect(body.resource).toBe('https://app.example.com/functions/v1/my-fn')
  })
})

describe('withOAuthProtectedResource - platform argument', () => {
  it('no longer forwards the raw platform argument — the inner handler receives ctx instead', async () => {
    let seen: unknown
    const handler = async (_req: Request, platformArg?: unknown) => {
      seen = platformArg
      return new Response('ok')
    }
    const env = { MY_BINDING: 'value' }
    await withOAuthProtectedResource(handler)(req('POST', '/my-fn'), env)
    expect(seen).not.toBe(env)
  })
})

describe('withOAuthProtectedResource - off-platform 401 discovery flow', () => {
  const staticConfig = { resourceServer: 'https://api.example.com/mcp' }

  it('enriches a 401 with the configured resourceServer, not a derived one', async () => {
    offEdgeFunctions()
    const res = await withOAuthProtectedResource(
      staticConfig,
      returns401,
    )(
      req('POST', '/api/mcp', {
        'X-Forwarded-Host': 'app.vercel.app',
        'X-Forwarded-Proto': 'https',
      }),
    )
    expect(res.status).toBe(401)
    expect(res.headers.get('WWW-Authenticate')).toBe(
      'Bearer resource_metadata="https://api.example.com/mcp/oauth-protected-resource"',
    )
    expect(res.headers.get('WWW-Authenticate')).not.toContain('vercel')
    expect(res.headers.get('WWW-Authenticate')).not.toContain('/functions/v1')
  })

  it('enriches a 401 with a request-derived resourceServer', async () => {
    offEdgeFunctions()
    const res = await withOAuthProtectedResource(
      { resourceServer: (r) => `${new URL(r.url).origin}/api/mcp` },
      returns401,
    )(req('POST', '/api/mcp'))
    expect(res.headers.get('WWW-Authenticate')).toBe(
      'Bearer resource_metadata="http://localhost/api/mcp/oauth-protected-resource"',
    )
  })

  it("preserves the handler's own WWW-Authenticate off platform", async () => {
    offEdgeFunctions()
    const handlerSetsHeader = async () =>
      new Response(null, {
        status: 401,
        headers: { 'WWW-Authenticate': 'Bearer error="invalid_token"' },
      })
    const res = await withOAuthProtectedResource(
      staticConfig,
      handlerSetsHeader,
    )(req('POST', '/api/mcp'))
    expect(res.headers.get('WWW-Authenticate')).toBe(
      'Bearer error="invalid_token"',
    )
  })

  it('preserves the 401 body and headers while enriching', async () => {
    offEdgeFunctions()
    const handler = async () =>
      new Response(JSON.stringify({ error: 'Unauthorized' }), {
        status: 401,
        headers: { 'Content-Type': 'application/json', 'X-Trace': 'abc' },
      })
    const res = await withOAuthProtectedResource(
      staticConfig,
      handler,
    )(req('POST', '/api/mcp'))
    expect(res.headers.get('X-Trace')).toBe('abc')
    expect(await res.json()).toEqual({ error: 'Unauthorized' })
  })

  it('round trip: the metadata at the advertised URL satisfies RFC 9728 §3.3', async () => {
    offEdgeFunctions()
    setEnv('SUPABASE_URL', 'https://ref.supabase.co')
    const app = withOAuthProtectedResource(staticConfig, returns401)

    const unauthorized = await app(req('POST', '/api/mcp'))
    const advertised = /resource_metadata="([^"]+)"/.exec(
      unauthorized.headers.get('WWW-Authenticate') ?? '',
    )?.[1]
    expect(advertised).toBe(
      'https://api.example.com/mcp/oauth-protected-resource',
    )

    // Fetch exactly what was advertised, as a client would.
    const metadata = await app(
      new Request(advertised!, { method: 'GET' }),
    ).then((r) => r.json())
    expect(`${metadata.resource}/oauth-protected-resource`).toBe(advertised)
    expect(metadata.authorization_servers).toEqual([
      'https://ref.supabase.co/auth/v1',
    ])
  })
})

describe('withOAuthProtectedResource - off-platform defaults fail loudly', () => {
  const vercelHeaders = {
    'X-Forwarded-Host': 'app.vercel.app',
    'X-Forwarded-Proto': 'https',
  }

  const clearEnv = () => {
    setEnv('SUPABASE_URL', undefined)
    setEnv('SUPABASE_PUBLIC_URL', undefined)
  }

  it('throws MISSING_RESOURCE_SERVER when resourceServer is absent', async () => {
    offEdgeFunctions()
    clearEnv()
    await expect(
      withOAuthProtectedResource(passthrough)(
        req('GET', '/api/mcp/oauth-protected-resource', vercelHeaders),
      ),
    ).rejects.toMatchObject({
      constructor: EnvError,
      code: MissingResourceServerError,
      status: 500,
    })
  })

  it('throws on every request, not just the metadata route', async () => {
    // getResourceUrl also backs the ctx contribution and the 401 header.
    offEdgeFunctions()
    clearEnv()
    await expect(
      withOAuthProtectedResource(passthrough)(req('POST', '/api/mcp')),
    ).rejects.toBeInstanceOf(EnvError)
  })

  it('throws MISSING_AUTHORIZATION_SERVER when only resourceServer is set', async () => {
    offEdgeFunctions()
    clearEnv()
    await expect(
      withOAuthProtectedResource(
        { resourceServer: 'https://api.example.com/mcp' },
        passthrough,
      )(req('GET', '/api/mcp/oauth-protected-resource', vercelHeaders)),
    ).rejects.toMatchObject({
      code: MissingAuthorizationServerError,
      status: 500,
    })
  })

  it('the error names the option to set', async () => {
    offEdgeFunctions()
    clearEnv()
    const call = withOAuthProtectedResource(passthrough)(
      req('GET', '/api/mcp/oauth-protected-resource'),
    )
    await expect(call).rejects.toThrow(/resourceServer/)
    await expect(call).rejects.toThrow(/withOAuthProtectedResource\(\)/)
  })

  it('a fully configured stack never reaches the env at all', async () => {
    offEdgeFunctions()
    clearEnv()
    const res = await withOAuthProtectedResource(
      {
        resourceServer: 'https://api.example.com/mcp',
        authorizationServer: 'https://example.clerk.accounts.dev',
      },
      passthrough,
    )(req('GET', '/api/mcp/oauth-protected-resource', vercelHeaders))
    expect(await res.json()).toMatchObject({
      resource: 'https://api.example.com/mcp',
      authorization_servers: ['https://example.clerk.accounts.dev'],
    })
  })

  it('SUPABASE_PUBLIC_URL outranks SUPABASE_URL for the issuer', async () => {
    offEdgeFunctions()
    setEnv('SUPABASE_PUBLIC_URL', 'https://public.example.com')
    setEnv('SUPABASE_URL', 'https://ref.supabase.co')
    const res = await withOAuthProtectedResource(
      { resourceServer: 'https://api.example.com/mcp' },
      passthrough,
    )(req('GET', '/api/mcp/oauth-protected-resource'))
    const body = await res.json()
    expect(body.authorization_servers).toEqual([
      'https://public.example.com/auth/v1',
    ])
  })

  it('an explicit authorizationServer outranks both env rungs', async () => {
    offEdgeFunctions()
    setEnv('SUPABASE_PUBLIC_URL', 'https://public.example.com')
    setEnv('SUPABASE_URL', 'https://ref.supabase.co')
    const res = await withOAuthProtectedResource(
      {
        resourceServer: 'https://api.example.com/mcp',
        authorizationServer: fromSupabaseUrl('https://explicit.supabase.co'),
      },
      passthrough,
    )(req('GET', '/api/mcp/oauth-protected-resource'))
    const body = await res.json()
    expect(body.authorization_servers).toEqual([
      'https://explicit.supabase.co/auth/v1',
    ])
  })
})

describe('withOAuthProtectedResource - WWW-Authenticate quoted-string integrity', () => {
  // A raw `"` in the advertised URL terminates the RFC 9110 quoted-string
  // early, letting the remainder parse as extra auth-params (parameter
  // injection). `"` and `\` are invalid URL code points anyway, so they are
  // percent-encoded — in the header, the metadata document, and the ctx
  // contribution alike, keeping the RFC 9728 §3.3 comparison intact.
  it('percent-encodes `"` arriving via X-Forwarded-Host', async () => {
    const res = await withOAuthProtectedResource(returns401)(
      req('POST', '/my-fn', { 'X-Forwarded-Host': 'evil.test", scope="admin' }),
    )
    expect(res.headers.get('WWW-Authenticate')).toBe(
      'Bearer resource_metadata="http://evil.test%22, scope=%22admin/functions/v1/my-fn/oauth-protected-resource"',
    )
  })

  it('percent-encodes `"` and `\\` in a configured resourceServer', async () => {
    const res = await withOAuthProtectedResource(
      {
        resourceServer: 'https://api.example.com/m"c\\p',
        authorizationServer: 'https://auth.example.com',
      },
      returns401,
    )(req('POST', '/my-fn'))
    expect(res.headers.get('WWW-Authenticate')).toBe(
      'Bearer resource_metadata="https://api.example.com/m%22c%5Cp/oauth-protected-resource"',
    )
  })

  it('advertises the same encoded resource in the metadata document (§3.3 agreement)', async () => {
    const res = await withOAuthProtectedResource(passthrough)(
      req('GET', '/my-fn/oauth-protected-resource', {
        'X-Forwarded-Host': 'evil.test"h',
      }),
    )
    const body = await res.json()
    expect(body.resource).toBe('http://evil.test%22h/functions/v1/my-fn')
  })
})

describe('withOAuthProtectedResource - 401 enrichment resilience', () => {
  it('enriches a 401 whose body the handler already consumed', async () => {
    const handler = async () => {
      const res = new Response('denied', { status: 401 })
      await res.text()
      return res
    }
    const res = await withOAuthProtectedResource(handler)(req('POST', '/my-fn'))
    expect(res.status).toBe(401)
    expect(res.headers.get('WWW-Authenticate')).toMatch(/^Bearer /)
  })

  it('enriches the 401 in place, so fetch-carried fields (.url, .redirected) survive', async () => {
    let issued: Response | undefined
    const handler = async () => {
      issued = new Response(null, { status: 401 })
      return issued
    }
    const res = await withOAuthProtectedResource(handler)(req('POST', '/my-fn'))
    expect(res).toBe(issued)
  })

  it('enriches a fetch()-proxied 401, whose headers are immutable', async () => {
    const upstream = createServer((_req, res) => {
      res.statusCode = 401
      res.setHeader('X-Upstream', 'yes')
      res.end('denied')
    })
    await new Promise<void>((resolve) => upstream.listen(0, resolve))
    const { port } = upstream.address() as AddressInfo
    try {
      const handler = async () => fetch(`http://127.0.0.1:${port}/`)
      const res = await withOAuthProtectedResource(handler)(
        req('POST', '/my-fn'),
      )
      expect(res.status).toBe(401)
      expect(res.headers.get('WWW-Authenticate')).toMatch(/resource_metadata=/)
      expect(res.headers.get('X-Upstream')).toBe('yes')
      expect(await res.text()).toBe('denied')
    } finally {
      upstream.close()
    }
  })
})

describe('withOAuthProtectedResource - root path (no function segment)', () => {
  // With no slug and no path segment there is no function name to restore, so
  // the reconstruction would advertise a bare `/functions/v1` — a URL that
  // identifies no resource. Failing loudly matches the off-platform contract.
  it('throws MISSING_RESOURCE_SERVER on a bare /oauth-protected-resource (edge default)', async () => {
    setEnv('SUPABASE_PUBLIC_URL', undefined)
    setEnv('SUPABASE_FUNCTION_SLUG', undefined)
    await expect(
      withOAuthProtectedResource(passthrough)(
        req('GET', '/oauth-protected-resource'),
      ),
    ).rejects.toMatchObject({
      constructor: EnvError,
      code: MissingResourceServerError,
      status: 500,
    })
  })

  it('resourceMetadataResponse on a root path throws instead of advertising a bare /functions/v1', () => {
    setEnv('SUPABASE_PUBLIC_URL', undefined)
    setEnv('SUPABASE_FUNCTION_SLUG', undefined)
    let thrown: unknown
    try {
      resourceMetadataResponse(req('GET', '/'))
    } catch (e) {
      thrown = e
    }
    expect(thrown).toBeInstanceOf(EnvError)
    expect(thrown).toMatchObject({ code: MissingResourceServerError })
  })

  it('SUPABASE_FUNCTION_SLUG rescues a root path with a canonical identifier', async () => {
    setEnv('SUPABASE_PUBLIC_URL', undefined)
    setEnv('SUPABASE_FUNCTION_SLUG', 'my-fn')
    const res = await withOAuthProtectedResource(passthrough)(
      req('GET', '/oauth-protected-resource'),
    )
    const body = await res.json()
    expect(body.resource).toBe('http://localhost/functions/v1/my-fn')
  })
})
