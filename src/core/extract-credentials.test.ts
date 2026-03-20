import { describe, expect, it } from 'vitest'

import { extractCredentials } from './extract-credentials.js'

describe('extractCredentials', () => {
  it('extracts Bearer token from Authorization header', () => {
    const req = new Request('http://localhost', {
      headers: { Authorization: 'Bearer test-token' },
    })
    const creds = extractCredentials(req)
    expect(creds.token).toBe('test-token')
    expect(creds.apikey).toBeNull()
  })

  it('extracts apikey header', () => {
    const req = new Request('http://localhost', {
      headers: { apikey: 'my-api-key' },
    })
    const creds = extractCredentials(req)
    expect(creds.token).toBeNull()
    expect(creds.apikey).toBe('my-api-key')
  })

  it('extracts both token and apikey', () => {
    const req = new Request('http://localhost', {
      headers: {
        Authorization: 'Bearer test-token',
        apikey: 'my-api-key',
      },
    })
    const creds = extractCredentials(req)
    expect(creds.token).toBe('test-token')
    expect(creds.apikey).toBe('my-api-key')
  })

  it('returns nulls when no credentials present', () => {
    const req = new Request('http://localhost')
    const creds = extractCredentials(req)
    expect(creds.token).toBeNull()
    expect(creds.apikey).toBeNull()
  })

  it('ignores non-Bearer Authorization headers', () => {
    const req = new Request('http://localhost', {
      headers: { Authorization: 'Basic dXNlcjpwYXNz' },
    })
    const creds = extractCredentials(req)
    expect(creds.token).toBeNull()
  })

  it('returns null for empty Bearer token', () => {
    const req = new Request('http://localhost', {
      headers: { Authorization: 'Bearer ' },
    })
    const creds = extractCredentials(req)
    expect(creds.token).toBeNull()
  })

  it('returns null for whitespace-only Bearer token', () => {
    const req = new Request('http://localhost', {
      headers: { Authorization: 'Bearer   ' },
    })
    const creds = extractCredentials(req)
    // Request headers trim trailing whitespace, so "Bearer   " becomes "Bearer"
    // which doesn't start with "Bearer " (with space), returning null
    expect(creds.token).toBeNull()
  })

  it('is case-sensitive for Bearer prefix', () => {
    const req = new Request('http://localhost', {
      headers: { Authorization: 'bearer test-token' },
    })
    const creds = extractCredentials(req)
    expect(creds.token).toBeNull()
  })
})
