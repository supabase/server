import { pipeline } from '@supabase/middleware'
import { describe, expect, it } from 'vitest'

import type { SupabaseClient } from '@supabase/supabase-js'

import {
  CreateSupabaseClientError,
  EnvError,
  MissingPublishableKeyError,
  MissingSupabaseURLError,
} from '../../errors.js'
import { withSupabaseClient } from './index.js'

const baseEnv = {
  url: 'https://test.supabase.co',
  publishableKeys: { default: 'sb_publishable_xyz', web: 'sb_publishable_web' },
  secretKeys: { default: 'sb_secret_xyz' },
  jwks: null,
}

describe('withSupabaseClient', () => {
  it('contributes ctx.supabase in a standalone pipeline', async () => {
    let seen: SupabaseClient | undefined
    const handler = pipeline(
      [withSupabaseClient({ env: baseEnv })],
      async (_req, ctx) => {
        seen = ctx.supabase
        return Response.json({ ok: true })
      },
    )

    const res = await handler(new Request('http://localhost'))
    expect(res.status).toBe(200)
    expect(seen).toBeDefined()
    expect(typeof seen!.from).toBe('function')
  })

  it("selects the matched publishable key from an upstream withSupabase context's authKeyName", async () => {
    const handler = pipeline(
      [
        withSupabaseClient({
          env: {
            ...baseEnv,
            publishableKeys: { default: 'sb_publishable_xyz' },
          },
        }),
      ],
      async () => Response.json({ ok: true }),
    )

    // authKeyName 'web' is not in the key set — the throw proves the named
    // key is what the middleware asked for.
    await expect(
      handler(new Request('http://localhost'), {
        [Symbol.for('@supabase/middleware:context')]: true,
        authMode: 'publishable',
        authKeyName: 'web',
      } as never),
    ).rejects.toMatchObject({ code: MissingPublishableKeyError })
  })

  it('throws EnvError when SUPABASE_URL is missing', async () => {
    const handler = pipeline(
      [withSupabaseClient({ env: { ...baseEnv, url: '' } })],
      async () => Response.json({ ok: true }),
    )

    await expect(
      handler(new Request('http://localhost')),
    ).rejects.toMatchObject({
      code: MissingSupabaseURLError,
    })
    await expect(
      handler(new Request('http://localhost')),
    ).rejects.toBeInstanceOf(EnvError)
  })
  it('attaches the underlying failure as `cause` when client creation fails', async () => {
    // A malformed URL passes env resolution but throws inside createClient —
    // the hint on this error tells the reader to log `cause`, so it must be set.
    const handler = pipeline(
      [withSupabaseClient({ env: { ...baseEnv, url: 'not-a-url' } })],
      async () => Response.json({ ok: true }),
    )

    await expect(
      handler(new Request('http://localhost')),
    ).rejects.toMatchObject({
      code: CreateSupabaseClientError,
      cause: expect.any(Error),
    })
  })
})
