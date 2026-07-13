import { describe, expect, it } from 'vitest'

import { addCorsHeaders, buildCorsHeaders, isCorsDisabled } from './cors.js'

describe('buildCorsHeaders', () => {
  it("returns supabase-js defaults when config is 'default'", () => {
    const headers = buildCorsHeaders('default')
    expect(headers['Access-Control-Allow-Origin']).toBe('*')
    expect(headers['Access-Control-Allow-Methods']).toContain('GET')
    expect(headers['Access-Control-Allow-Headers']).toContain('authorization')
  })

  it('returns supabase-js defaults when config is undefined', () => {
    const headers = buildCorsHeaders()
    expect(headers['Access-Control-Allow-Origin']).toBe('*')
  })

  it("returns empty object when config is 'disabled'", () => {
    expect(buildCorsHeaders('disabled')).toEqual({})
  })

  it('returns the inner headers from the { headers } shape', () => {
    const headers = {
      'Access-Control-Allow-Origin': 'https://example.com',
      'Access-Control-Allow-Headers': 'X-Custom',
    }
    expect(buildCorsHeaders({ headers })).toBe(headers)
  })

  // Deprecated forms — still supported for backward compatibility.
  it('returns supabase-js defaults when config is true (deprecated)', () => {
    const headers = buildCorsHeaders(true)
    expect(headers['Access-Control-Allow-Origin']).toBe('*')
    expect(headers['Access-Control-Allow-Methods']).toContain('GET')
    expect(headers['Access-Control-Allow-Headers']).toContain('authorization')
  })

  it('returns empty object when config is false (deprecated)', () => {
    expect(buildCorsHeaders(false)).toEqual({})
  })

  it('returns a bare custom headers record as-is (deprecated)', () => {
    const custom = {
      'Access-Control-Allow-Origin': 'https://example.com',
      'Access-Control-Allow-Headers': 'X-Custom',
    }
    expect(buildCorsHeaders(custom)).toBe(custom)
  })
})

describe('isCorsDisabled', () => {
  it("is true for 'disabled' and the deprecated false", () => {
    expect(isCorsDisabled('disabled')).toBe(true)
    expect(isCorsDisabled(false)).toBe(true)
  })

  it('is false for enabled configurations', () => {
    expect(isCorsDisabled('default')).toBe(false)
    expect(isCorsDisabled(true)).toBe(false)
    expect(isCorsDisabled()).toBe(false)
    expect(isCorsDisabled({ headers: { 'X-Custom': '1' } })).toBe(false)
    expect(isCorsDisabled({ 'Access-Control-Allow-Origin': '*' })).toBe(false)
  })
})

describe('addCorsHeaders', () => {
  it('adds default CORS headers to response', () => {
    const response = new Response('ok')
    const result = addCorsHeaders(response, true)
    expect(result.headers.get('Access-Control-Allow-Origin')).toBe('*')
  })

  it("returns response unchanged when config is 'disabled'", () => {
    const response = new Response('ok')
    const result = addCorsHeaders(response, 'disabled')
    expect(result.headers.get('Access-Control-Allow-Origin')).toBeNull()
  })

  it('returns response unchanged when config is false (deprecated)', () => {
    const response = new Response('ok')
    const result = addCorsHeaders(response, false)
    expect(result.headers.get('Access-Control-Allow-Origin')).toBeNull()
  })

  it('adds custom headers from the { headers } shape to response', () => {
    const response = new Response('ok')
    const result = addCorsHeaders(response, {
      headers: { 'Access-Control-Allow-Origin': 'https://example.com' },
    })
    expect(result.headers.get('Access-Control-Allow-Origin')).toBe(
      'https://example.com',
    )
  })

  it('adds a bare custom headers record to response (deprecated)', () => {
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
