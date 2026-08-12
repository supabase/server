import { describe, expect, it } from 'vitest'

import { resourceMetadataResponse, unauthorizedResponse } from './responses.js'
import { withOAuthProtectedResource } from './with-oauth-protected-resource.js'

const req = (method: string, path: string, headers?: Record<string, string>) =>
  new Request(`http://localhost${path}`, { method, headers })

const passthrough = async () => new Response('ok', { status: 200 })
const returns401 = async () =>
  new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401 })

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

  it('ignores POST to /fn/oauth-protected-resource (passes through)', async () => {
    const res = await withOAuthProtectedResource(passthrough)(
      req('POST', '/my-fn/oauth-protected-resource'),
    )
    expect(res.status).toBe(404)
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
  it('returns 404 for unrecognized sub-paths', async () => {
    // /my-fn/something is not a registered route under the my-fn function
    const res = await withOAuthProtectedResource(passthrough)(
      req('POST', '/my-fn/something'),
    )
    expect(res.status).toBe(404)
  })

  it('infers function name from first path segment', async () => {
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
})
