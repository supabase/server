import { describe, expect, it } from 'vitest'

import { withClaims } from './index.js'

function base64url(obj: unknown): string {
  return Buffer.from(JSON.stringify(obj))
    .toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '')
}

function tokenFor(claims: Record<string, unknown>): string {
  return `header.${base64url(claims)}.sig`
}

const runtime = { name: 'node' as const, getEnv: () => undefined }

describe('withClaims', () => {
  it('decodes the Bearer token payload into ctx.jwtClaims', async () => {
    let seen: unknown
    const handler = withClaims(async (_req, ctx) => {
      seen = ctx.jwtClaims
      return Response.json({ ok: true })
    })

    await handler(
      new Request('http://localhost', {
        headers: {
          Authorization: `Bearer ${tokenFor({ sub: 'u1', role: 'authenticated' })}`,
        },
      }),
      { _runtime: runtime },
    )

    expect(seen).toEqual({ sub: 'u1', role: 'authenticated' })
  })

  it('contributes null when no Authorization header is present', async () => {
    let seen: unknown = 'unset'
    const handler = withClaims(async (_req, ctx) => {
      seen = ctx.jwtClaims
      return Response.json({ ok: true })
    })

    await handler(new Request('http://localhost'), { _runtime: runtime })

    expect(seen).toBeNull()
  })

  it('contributes null for a malformed token', async () => {
    let seen: unknown = 'unset'
    const handler = withClaims(async (_req, ctx) => {
      seen = ctx.jwtClaims
      return Response.json({ ok: true })
    })

    await handler(
      new Request('http://localhost', {
        headers: { Authorization: 'Bearer not-a-jwt' },
      }),
      { _runtime: runtime },
    )

    expect(seen).toBeNull()
  })
})
