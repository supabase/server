import { describe, expect, it } from 'vitest'

import { addCorsHeaders, buildCorsHeaders } from './cors.js'

describe('buildCorsHeaders', () => {
  it('returns default CORS headers when config is true/undefined', () => {
    const headers = buildCorsHeaders(true)
    expect(headers['Access-Control-Allow-Origin']).toBe('*')
    expect(headers['Access-Control-Allow-Methods']).toContain('GET')
    expect(headers['Access-Control-Allow-Headers']).toContain('Authorization')
  })

  it('returns empty object when config is false', () => {
    expect(buildCorsHeaders(false)).toEqual({})
  })

  it('respects custom origins', () => {
    const headers = buildCorsHeaders({ origins: 'https://example.com' })
    expect(headers['Access-Control-Allow-Origin']).toBe('https://example.com')
  })

  it('joins array origins', () => {
    const headers = buildCorsHeaders({
      origins: ['https://a.com', 'https://b.com'],
    })
    expect(headers['Access-Control-Allow-Origin']).toBe(
      'https://a.com, https://b.com',
    )
  })

  it('sets credentials header when enabled', () => {
    const headers = buildCorsHeaders({ credentials: true })
    expect(headers['Access-Control-Allow-Credentials']).toBe('true')
  })

  it('sets maxAge', () => {
    const headers = buildCorsHeaders({ maxAge: 3600 })
    expect(headers['Access-Control-Max-Age']).toBe('3600')
  })
})

describe('addCorsHeaders', () => {
  it('adds CORS headers to response', () => {
    const response = new Response('ok')
    const result = addCorsHeaders(response, true)
    expect(result.headers.get('Access-Control-Allow-Origin')).toBe('*')
  })

  it('returns response unchanged when config is false', () => {
    const response = new Response('ok')
    const result = addCorsHeaders(response, false)
    expect(result.headers.get('Access-Control-Allow-Origin')).toBeNull()
  })
})
