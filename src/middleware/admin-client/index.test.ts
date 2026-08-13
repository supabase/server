import { pipeline } from '@supabase/middleware'
import { describe, expect, it } from 'vitest'

import type { SupabaseClient } from '@supabase/supabase-js'

import {
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
    const handler = pipeline([withSupabaseAdminClient({ env: baseEnv })], () =>
      Promise.resolve(Response.json({ ok: true })),
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

  it('throws EnvError when no secret key exists', async () => {
    const handler = pipeline(
      [withSupabaseAdminClient({ env: { ...baseEnv, secretKeys: {} } })],
      async () => Response.json({ ok: true }),
    )

    await expect(
      handler(new Request('http://localhost')),
    ).rejects.toMatchObject({ code: MissingDefaultSecretKeyError })
    await expect(
      handler(new Request('http://localhost')),
    ).rejects.toBeInstanceOf(EnvError)
  })
})
