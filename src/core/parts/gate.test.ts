import { describe, expect, it } from 'vitest'
import { pipeline } from '@supabase/middleware'

import { ErrorCodeHeader, MissingCredentialsError } from '../../errors.js'
import { withAuthGate } from './gate.js'
import {
  withAuthKeyName,
  withAuthMode,
  withJwtClaims,
  withUserClaims,
} from './projections.js'

const baseEnv = {
  url: 'https://test.supabase.co',
  publishableKeys: { default: 'sb_publishable_xyz' },
  secretKeys: { default: 'sb_secret_xyz' },
  jwks: null,
}

describe('withAuthGate', () => {
  it('short-circuits with the JSON error when credentials are missing', async () => {
    const res = await withAuthGate(
      { auth: 'user', env: baseEnv },
      async () => new Response('unreachable'),
    )(new Request('http://localhost'))
    expect(res.status).toBe(401)
    expect(res.headers.get(ErrorCodeHeader)).toBe(MissingCredentialsError)
    expect((await res.json()).code).toBe(MissingCredentialsError)
    expect(res.headers.get('Access-Control-Allow-Origin')).toBeNull()
  })

  it("contributes the verified identity under auth: 'none'", async () => {
    const res = await withAuthGate(
      { auth: 'none', env: baseEnv },
      async (_req, ctx) => Response.json(ctx.supabaseAuth),
    )(new Request('http://localhost'))
    expect(await res.json()).toEqual({
      userClaims: null,
      jwtClaims: null,
      authMode: 'none',
    })
  })

  it('honors errors: { detailed: false } on the short-circuit', async () => {
    const res = await withAuthGate(
      { auth: 'user', env: baseEnv, errors: { detailed: false } },
      async () => new Response('unreachable'),
    )(new Request('http://localhost'))
    expect(await res.json()).toEqual({
      code: MissingCredentialsError,
      message: expect.any(String),
    })
  })
})

describe('projections', () => {
  it('republish each field of the gate result as its own key', async () => {
    const handler = pipeline(
      [
        withAuthGate({ auth: 'none', env: baseEnv }),
        withUserClaims(),
        withJwtClaims(),
        withAuthMode(),
        withAuthKeyName(),
      ],
      async (_req, ctx) =>
        Response.json({
          keys: Object.keys(ctx).sort(),
          authMode: ctx.authMode,
        }),
    )
    const body = await (await handler(new Request('http://localhost'))).json()
    expect(body.authMode).toBe('none')
    expect(body.keys).toEqual([
      'authKeyName',
      'authMode',
      'jwtClaims',
      'supabaseAuth',
      'userClaims',
    ])
  })
})
