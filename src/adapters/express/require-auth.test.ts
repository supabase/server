import type { AddressInfo } from 'node:net'

import express, { type Express, type ErrorRequestHandler } from 'express'
import { describe, expect, it } from 'vitest'

import type { SupabaseEnv } from '../../types.js'
import { withSupabase } from './middleware.js'
import { requireAuth } from './require-auth.js'

const reportAuthError: ErrorRequestHandler = (err, _req, res, next) => {
  const e = err as { status?: number; code?: string; message: string }
  if (!e || typeof e.status !== 'number') {
    next(err)
    return
  }
  res.status(e.status).json({ error: e.message, code: e.code })
}

function makeEnv(overrides?: Partial<SupabaseEnv>): Partial<SupabaseEnv> {
  return {
    url: 'https://test.supabase.co',
    publishableKeys: {
      default: 'sb_publishable_xyz',
      web: 'sb_publishable_web',
    },
    secretKeys: { default: 'sb_secret_xyz' },
    jwks: null,
    ...overrides,
  }
}

interface RunResult {
  status: number
  body: string
}

async function withApp(
  configure: (app: Express) => void,
  request: (port: number) => Promise<RunResult>,
): Promise<RunResult> {
  const app = express()
  configure(app)

  const server = app.listen(0)
  await new Promise<void>((resolve) => server.once('listening', resolve))
  const port = (server.address() as AddressInfo).port

  try {
    return await request(port)
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()))
  }
}

async function fetchJson(port: number, init?: RequestInit): Promise<RunResult> {
  const res = await fetch(`http://127.0.0.1:${port}/`, init)
  return { status: res.status, body: await res.text() }
}

describe('requireAuth', () => {
  it('passes through when context is set and no modes are specified', async () => {
    const result = await withApp(
      (app) => {
        app.use(withSupabase({ auth: 'none', env: makeEnv() }))
        app.get('/', requireAuth(), (_req, res) => {
          res.json({ ok: true, authMode: res.locals.supabaseContext.authMode })
        })
      },
      (port) => fetchJson(port),
    )

    expect(result.status).toBe(200)
    expect(JSON.parse(result.body)).toEqual({ ok: true, authMode: 'none' })
  })

  it('passes through when the established mode matches the single allowed mode', async () => {
    const result = await withApp(
      (app) => {
        app.use(withSupabase({ auth: 'publishable', env: makeEnv() }))
        app.get('/', requireAuth('publishable'), (_req, res) => {
          res.json({ authMode: res.locals.supabaseContext.authMode })
        })
      },
      (port) => fetchJson(port, { headers: { apikey: 'sb_publishable_xyz' } }),
    )

    expect(result.status).toBe(200)
    expect(JSON.parse(result.body)).toEqual({ authMode: 'publishable' })
  })

  it('passes through when the established mode matches one of an array of modes', async () => {
    const result = await withApp(
      (app) => {
        app.use(withSupabase({ auth: ['user', 'publishable'], env: makeEnv() }))
        app.get('/', requireAuth(['user', 'publishable']), (_req, res) => {
          res.json({ authMode: res.locals.supabaseContext.authMode })
        })
      },
      (port) => fetchJson(port, { headers: { apikey: 'sb_publishable_xyz' } }),
    )

    expect(result.status).toBe(200)
    expect(JSON.parse(result.body)).toEqual({ authMode: 'publishable' })
  })

  it('passes through with publishable:<name> when the established keyName matches', async () => {
    const result = await withApp(
      (app) => {
        app.use(withSupabase({ auth: 'publishable:web', env: makeEnv() }))
        app.get('/', requireAuth('publishable:web'), (_req, res) => {
          res.json({
            authMode: res.locals.supabaseContext.authMode,
            authKeyName: res.locals.supabaseContext.authKeyName,
          })
        })
      },
      (port) => fetchJson(port, { headers: { apikey: 'sb_publishable_web' } }),
    )

    expect(result.status).toBe(200)
    expect(JSON.parse(result.body)).toEqual({
      authMode: 'publishable',
      authKeyName: 'web',
    })
  })

  it('passes through with the publishable:* wildcard', async () => {
    const result = await withApp(
      (app) => {
        app.use(withSupabase({ auth: 'publishable:*', env: makeEnv() }))
        app.get('/', requireAuth('publishable:*'), (_req, res) => {
          res.json({
            authMode: res.locals.supabaseContext.authMode,
            authKeyName: res.locals.supabaseContext.authKeyName,
          })
        })
      },
      (port) => fetchJson(port, { headers: { apikey: 'sb_publishable_web' } }),
    )

    expect(result.status).toBe(200)
    expect(JSON.parse(result.body)).toEqual({
      authMode: 'publishable',
      authKeyName: 'web',
    })
  })

  it('fails with 401 when the context is missing (withSupabase was not mounted)', async () => {
    const result = await withApp(
      (app) => {
        app.get('/', requireAuth(), (_req, res) => res.json({ ok: true }))
        app.use(reportAuthError)
      },
      (port) => fetchJson(port),
    )

    expect(result.status).toBe(401)
    const body = JSON.parse(result.body) as { error: string; code: string }
    expect(body.code).toBe('INVALID_CREDENTIALS')
  })

  it('fails with 401 when the established mode does not match any of the allowed modes', async () => {
    const result = await withApp(
      (app) => {
        app.use(withSupabase({ auth: 'none', env: makeEnv() }))
        app.get('/', requireAuth('user'), (_req, res) => res.json({ ok: true }))
        app.use(reportAuthError)
      },
      (port) => fetchJson(port),
    )

    expect(result.status).toBe(401)
    const body = JSON.parse(result.body) as { error: string; code: string }
    expect(body.code).toBe('INVALID_CREDENTIALS')
  })

  it('fails with 401 when the established keyName does not match the requested one', async () => {
    const result = await withApp(
      (app) => {
        app.use(withSupabase({ auth: 'publishable:*', env: makeEnv() }))
        // Authenticated with the "default" key, but the route requires "web".
        app.get('/', requireAuth('publishable:web'), (_req, res) =>
          res.json({ ok: true }),
        )
        app.use(reportAuthError)
      },
      (port) => fetchJson(port, { headers: { apikey: 'sb_publishable_xyz' } }),
    )

    expect(result.status).toBe(401)
    const body = JSON.parse(result.body) as { error: string; code: string }
    expect(body.code).toBe('INVALID_CREDENTIALS')
  })
})
