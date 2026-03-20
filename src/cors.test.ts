import { describe, expect, it } from 'vitest'

import { addCorsHeaders, buildCorsHeaders } from './cors.js'

describe('buildCorsHeaders', () => {
  it('returns supabase-js defaults when config is true', () => {
    const headers = buildCorsHeaders(true)
    expect(headers['Access-Control-Allow-Origin']).toBe('*')
    expect(headers['Access-Control-Allow-Methods']).toContain('GET')
    expect(headers['Access-Control-Allow-Headers']).toContain('authorization')
  })

  it('returns supabase-js defaults when config is undefined', () => {
    const headers = buildCorsHeaders()
    expect(headers['Access-Control-Allow-Origin']).toBe('*')
  })

  it('returns empty object when config is false', () => {
    expect(buildCorsHeaders(false)).toEqual({})
  })

  it('returns custom headers as-is', () => {
    const custom = {
      'Access-Control-Allow-Origin': 'https://example.com',
      'Access-Control-Allow-Headers': 'X-Custom',
    }
    expect(buildCorsHeaders(custom)).toBe(custom)
  })
})

describe('addCorsHeaders', () => {
  it('adds default CORS headers to response', () => {
    const response = new Response('ok')
    const result = addCorsHeaders(response, true)
    expect(result.headers.get('Access-Control-Allow-Origin')).toBe('*')
  })

  it('returns response unchanged when config is false', () => {
    const response = new Response('ok')
    const result = addCorsHeaders(response, false)
    expect(result.headers.get('Access-Control-Allow-Origin')).toBeNull()
  })

  it('adds custom headers to response', () => {
    const response = new Response('ok')
    const result = addCorsHeaders(response, {
      'Access-Control-Allow-Origin': 'https://example.com',
    })
    expect(result.headers.get('Access-Control-Allow-Origin')).toBe(
      'https://example.com',
    )
  })

  it('overwrites existing CORS headers on response', () => {
    const response = new Response('ok', {
      headers: { 'Access-Control-Allow-Origin': 'https://old.com' },
    })
    const result = addCorsHeaders(response, {
      'Access-Control-Allow-Origin': 'https://new.com',
    })
    expect(result.headers.get('Access-Control-Allow-Origin')).toBe(
      'https://new.com',
    )
  })
})
