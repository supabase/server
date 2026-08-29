import { pipeline } from '@supabase/middleware'
import { describe, expect, it } from 'vitest'

import { SupabaseClient } from '@supabase/supabase-js'

import {
  CreateSupabaseClientError,
  EnvError,
  MissingDefaultSecretKeyError,
  MissingSecretKeyError,
} from '../../errors.js'
import { withSupabaseAdminClient } from './index.js'

const baseEnv = {
  url: 'https://test.supabase.co',
  publishableKeys: { default: 'sb_publishable_xyz' },
  secretKeys: { default: 'sb_secret_xyz' },
  jwks: null,
}

describe('withSupabaseAdminClient', () => {
  it('contributes ctx.supabaseAdmin in a standalone pipeline', async () => {
    let seen: SupabaseClient | undefined
    const handler = pipeline(
      [withSupabaseAdminClient({ env: baseEnv })],
      async (_req, ctx) => {
        seen = ctx.supabaseAdmin
        return Response.json({ ok: true })
      },
    )

    const res = await handler(new Request('http://localhost'))
    expect(res.status).toBe(200)
    expect(seen).toBeDefined()
    expect(typeof seen!.from).toBe('function')
  })

  it("selects the matched secret key from an upstream withSupabase context's authKeyName", async () => {
    const handler = pipeline(
      [withSupabaseAdminClient({ env: baseEnv })],
      async (_req, ctx) => {
        ctx.supabaseAdmin.from('t')
        return Response.json({ ok: true })
      },
    )

    // authKeyName 'internal' is not in the key set — the throw proves the
    // named key is what the middleware asked for.
    await expect(
      handler(new Request('http://localhost'), {
        [Symbol.for('@supabase/middleware:context')]: true,
        authMode: 'secret',
        authKeyName: 'internal',
      } as never),
    ).rejects.toMatchObject({ code: MissingSecretKeyError })
  })

  it('succeeds without a secret key when the handler never accesses supabaseAdmin', async () => {
    const handler = pipeline(
      [withSupabaseAdminClient({ env: { ...baseEnv, secretKeys: {} } })],
      async () => Response.json({ ok: true }),
    )

    const res = await handler(new Request('http://localhost'))
    expect(res.status).toBe(200)
  })

  it('throws EnvError at the first supabaseAdmin access when no secret key exists', async () => {
    const handler = pipeline(
      [withSupabaseAdminClient({ env: { ...baseEnv, secretKeys: {} } })],
      async (_req, ctx) => {
        ctx.supabaseAdmin.from('t')
        return Response.json({ ok: true })
      },
    )

    await expect(
      handler(new Request('http://localhost')),
    ).rejects.toMatchObject({ code: MissingDefaultSecretKeyError })
    await expect(
      handler(new Request('http://localhost')),
    ).rejects.toBeInstanceOf(EnvError)
  })

  it('constructs the client once per request across accesses', async () => {
    let first: unknown
    let second: unknown
    const handler = pipeline(
      [withSupabaseAdminClient({ env: baseEnv })],
      async (_req, ctx) => {
        // `auth` is a constructor-assigned data property — identity across
        // accesses proves a single underlying client. (`functions` is a
        // getter that mints a new client per read, so it can't prove this.)
        first = ctx.supabaseAdmin.auth
        second = ctx.supabaseAdmin.auth
        return Response.json({ ok: true })
      },
    )

    const res = await handler(new Request('http://localhost'))
    expect(res.status).toBe(200)
    expect(first).toBeDefined()
    expect(first).toBe(second)
  })

  it('exposes a working SupabaseClient through the proxy', async () => {
    const handler = pipeline(
      [withSupabaseAdminClient({ env: baseEnv })],
      async (_req, ctx) => {
        return Response.json({
          isClient: ctx.supabaseAdmin instanceof SupabaseClient,
          hasSelect: typeof ctx.supabaseAdmin.from('t').select === 'function',
        })
      },
    )

    const res = await handler(new Request('http://localhost'))
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.isClient).toBe(true)
    expect(body.hasSelect).toBe(true)
  })
  it('attaches the underlying failure as `cause` when client creation fails', async () => {
    // A malformed URL passes env resolution but throws inside createClient —
    // the hint on this error tells the reader to log `cause`, so it must be set.
    const handler = pipeline(
      [withSupabaseAdminClient({ env: { ...baseEnv, url: 'not-a-url' } })],
      async (_req, ctx) => {
        // The client is lazy — touching it is what triggers construction.
        return Response.json({ ok: ctx.supabaseAdmin.auth !== undefined })
      },
    )

    await expect(
      handler(new Request('http://localhost')),
    ).rejects.toMatchObject({
      code: CreateSupabaseClientError,
      cause: expect.any(Error),
    })
  })
})
