import type { AddressInfo } from 'node:net'

import express, { type Express, type ErrorRequestHandler } from 'express'
import { describe, expect, it } from 'vitest'

import type { SupabaseEnv } from '../../types.js'
import { withSupabaseRoute } from './with-supabase-route.js'

const reportAuthError: ErrorRequestHandler = (err, _req, res, next) => {
  const e = err as { status?: number; code?: string; message: string }
  if (!e || typeof e.status !== 'number') {
    next(err)
    return
  }
  res.status(e.status).json({ error: e.message, code: e.code })
}

const reportGenericError: ErrorRequestHandler = (err, _req, res, next) => {
  const e = err as { message?: string }
  if (!e) {
    next(err)
    return
  }
  res.status(500).json({ error: e.message ?? 'unknown' })
}

function makeEnv(overrides?: Partial<SupabaseEnv>): Partial<SupabaseEnv> {
  return {
    url: 'https://test.supabase.co',
    publishableKeys: { default: 'sb_publishable_xyz' },
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

describe('withSupabaseRoute', () => {
  it('invokes the handler with the resolved context on success', async () => {
    const result = await withApp(
      (app) => {
        app.get(
          '/',
          withSupabaseRoute(
            { auth: 'publishable', env: makeEnv() },
            (_req, res, _next, ctx) => {
              res.json({
                authMode: ctx.authMode,
                hasSupabase: !!ctx.supabase,
                fromLocals: res.locals.supabaseContext.authMode,
              })
            },
          ),
        )
      },
      (port) => fetchJson(port, { headers: { apikey: 'sb_publishable_xyz' } }),
    )

    expect(result.status).toBe(200)
    expect(JSON.parse(result.body)).toEqual({
      authMode: 'publishable',
      hasSupabase: true,
      fromLocals: 'publishable',
    })
  })

  it('skips the handler and forwards AuthError via next() on auth failure', async () => {
    let handlerCalls = 0
    const result = await withApp(
      (app) => {
        app.get(
          '/',
          withSupabaseRoute(
            { auth: 'publishable', env: makeEnv() },
            (_req, res) => {
              handlerCalls += 1
              res.json({ ok: true })
            },
          ),
        )
        app.use(reportAuthError)
      },
      (port) => fetchJson(port),
    )

    expect(result.status).toBe(401)
    const body = JSON.parse(result.body) as { error: string; code: string }
    expect(body.code).toBe('INVALID_CREDENTIALS')
    expect(handlerCalls).toBe(0)
  })

  it('invokes a configured onError on auth failure instead of next(error)', async () => {
    let handlerCalls = 0
    const result = await withApp(
      (app) => {
        app.get(
          '/',
          withSupabaseRoute(
            {
              auth: 'publishable',
              env: makeEnv(),
              onError: (error, _req, res) => {
                res.status(error.status).json({
                  status: error.status,
                  code: error.code,
                })
              },
            },
            (_req, res) => {
              handlerCalls += 1
              res.json({ ok: true })
            },
          ),
        )
      },
      (port) => fetchJson(port),
    )

    expect(result.status).toBe(401)
    const body = JSON.parse(result.body) as { status: number; code: string }
    expect(body.status).toBe(401)
    expect(body.code).toBe('INVALID_CREDENTIALS')
    expect(handlerCalls).toBe(0)
  })

  it('forwards an async-thrown error from the handler via Express 5 native handling', async () => {
    const result = await withApp(
      (app) => {
        app.get(
          '/',
          withSupabaseRoute({ auth: 'none', env: makeEnv() }, async () => {
            await Promise.resolve()
            throw new Error('handler boom')
          }),
        )
        app.use(reportGenericError)
      },
      (port) => fetchJson(port),
    )

    expect(result.status).toBe(500)
    const body = JSON.parse(result.body) as { error: string }
    expect(body.error).toBe('handler boom')
  })

  it('forwards a thrown error from a custom onError via next(err)', async () => {
    const result = await withApp(
      (app) => {
        app.get(
          '/',
          withSupabaseRoute(
            {
              auth: 'publishable',
              env: makeEnv(),
              onError: () => {
                throw new Error('handler boom')
              },
            },
            (_req, res) => {
              res.json({ ok: true })
            },
          ),
        )
        app.use(reportGenericError)
      },
      (port) => fetchJson(port),
    )

    expect(result.status).toBe(500)
    const body = JSON.parse(result.body) as { error: string }
    expect(body.error).toBe('handler boom')
  })
})
