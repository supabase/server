import type { AddressInfo } from 'node:net'

import express, { type Express, type ErrorRequestHandler } from 'express'
import { exportJWK, generateKeyPair, SignJWT } from 'jose'
import { beforeAll, describe, expect, it } from 'vitest'

import type { JsonWebKeySet, SupabaseEnv } from '../../types.js'
import { withSupabase } from './middleware.js'

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

describe('express supabase middleware', () => {
  describe('none mode', () => {
    it('sets supabase context on successful auth', async () => {
      const result = await withApp(
        (app) => {
          app.use(withSupabase({ auth: 'none', env: makeEnv() }))
          app.get('/', (_req, res) => {
            const ctx = res.locals.supabaseContext
            res.json({
              authMode: ctx.authMode,
              hasSupabase: !!ctx.supabase,
              hasAdmin: !!ctx.supabaseAdmin,
            })
          })
        },
        (port) => fetchJson(port),
      )

      expect(result.status).toBe(200)
      const body = JSON.parse(result.body) as {
        authMode: string
        hasSupabase: boolean
        hasAdmin: boolean
      }
      expect(body.authMode).toBe('none')
      expect(body.hasSupabase).toBe(true)
      expect(body.hasAdmin).toBe(true)
    })
  })

  describe('publishable mode', () => {
    it('succeeds with valid publishable apikey header', async () => {
      const result = await withApp(
        (app) => {
          app.use(withSupabase({ auth: 'publishable', env: makeEnv() }))
          app.get('/', (_req, res) => {
            const ctx = res.locals.supabaseContext
            res.json({ authMode: ctx.authMode })
          })
        },
        (port) =>
          fetchJson(port, { headers: { apikey: 'sb_publishable_xyz' } }),
      )

      expect(result.status).toBe(200)
      expect(JSON.parse(result.body)).toEqual({ authMode: 'publishable' })
    })

    it('forwards AuthError to next() when apikey is missing', async () => {
      const result = await withApp(
        (app) => {
          app.use(withSupabase({ auth: 'publishable', env: makeEnv() }))
          app.get('/', (_req, res) => res.json({ ok: true }))
          app.use(reportAuthError)
        },
        (port) => fetchJson(port),
      )

      expect(result.status).toBe(401)
      const body = JSON.parse(result.body) as { error: string; code: string }
      expect(body.code).toBe('INVALID_CREDENTIALS')
    })
  })

  describe('secret mode', () => {
    it('succeeds with valid secret apikey header', async () => {
      const result = await withApp(
        (app) => {
          app.use(withSupabase({ auth: 'secret', env: makeEnv() }))
          app.get('/', (_req, res) => {
            const ctx = res.locals.supabaseContext
            res.json({ authMode: ctx.authMode })
          })
        },
        (port) => fetchJson(port, { headers: { apikey: 'sb_secret_xyz' } }),
      )

      expect(result.status).toBe(200)
      expect(JSON.parse(result.body)).toEqual({ authMode: 'secret' })
    })
  })

  describe('user mode', () => {
    let jwks: JsonWebKeySet
    let validToken: string

    beforeAll(async () => {
      const { privateKey, publicKey } = await generateKeyPair('RS256')
      const publicJwk = await exportJWK(publicKey)
      publicJwk.alg = 'RS256'
      publicJwk.use = 'sig'
      jwks = { keys: [publicJwk] }

      validToken = await new SignJWT({
        sub: 'user-123',
        role: 'authenticated',
        email: 'test@example.com',
      })
        .setProtectedHeader({ alg: 'RS256' })
        .setIssuedAt()
        .setExpirationTime('1h')
        .sign(privateKey)
    })

    it('succeeds with a valid JWT', async () => {
      const result = await withApp(
        (app) => {
          app.use(withSupabase({ auth: 'user', env: makeEnv({ jwks }) }))
          app.get('/', (_req, res) => {
            const ctx = res.locals.supabaseContext
            res.json({
              authMode: ctx.authMode,
              userId: ctx.userClaims?.id,
              email: ctx.userClaims?.email,
            })
          })
        },
        (port) =>
          fetchJson(port, {
            headers: { Authorization: `Bearer ${validToken}` },
          }),
      )

      expect(result.status).toBe(200)
      expect(JSON.parse(result.body)).toEqual({
        authMode: 'user',
        userId: 'user-123',
        email: 'test@example.com',
      })
    })

    it('forwards AuthError to next() on invalid JWT', async () => {
      const result = await withApp(
        (app) => {
          app.use(withSupabase({ auth: 'user', env: makeEnv({ jwks }) }))
          app.get('/', (_req, res) => res.json({ ok: true }))
          app.use(reportAuthError)
        },
        (port) =>
          fetchJson(port, {
            headers: { Authorization: 'Bearer not.a.real.jwt' },
          }),
      )

      expect(result.status).toBe(401)
      const body = JSON.parse(result.body) as { error: string; code: string }
      expect(body.code).toBe('INVALID_CREDENTIALS')
    })
  })

  describe('array auth form', () => {
    it('accepts a request that matches one of the listed modes', async () => {
      const result = await withApp(
        (app) => {
          app.use(
            withSupabase({ auth: ['user', 'publishable'], env: makeEnv() }),
          )
          app.get('/', (_req, res) => {
            const ctx = res.locals.supabaseContext
            res.json({ authMode: ctx.authMode })
          })
        },
        (port) =>
          fetchJson(port, { headers: { apikey: 'sb_publishable_xyz' } }),
      )

      expect(result.status).toBe(200)
      expect(JSON.parse(result.body)).toEqual({ authMode: 'publishable' })
    })
  })

  describe('missing credentials', () => {
    it('surfaces 401 via the error pipeline', async () => {
      const result = await withApp(
        (app) => {
          app.use(withSupabase({ auth: 'user', env: makeEnv() }))
          app.get('/', (_req, res) => res.json({ ok: true }))
          app.use(reportAuthError)
        },
        (port) => fetchJson(port),
      )

      expect(result.status).toBe(401)
      const body = JSON.parse(result.body) as { error: string; code: string }
      expect(body.code).toBe('INVALID_CREDENTIALS')
    })
  })

  describe('onError option', () => {
    it('defaults to next(error) when onError is omitted', async () => {
      const result = await withApp(
        (app) => {
          app.use(withSupabase({ auth: 'publishable', env: makeEnv() }))
          app.get('/', (_req, res) => res.json({ ok: true }))
          app.use(reportAuthError)
        },
        (port) => fetchJson(port),
      )

      expect(result.status).toBe(401)
      const body = JSON.parse(result.body) as { error: string; code: string }
      expect(body.code).toBe('INVALID_CREDENTIALS')
    })

    it('invokes a custom onError that responds directly', async () => {
      const result = await withApp(
        (app) => {
          app.use(
            withSupabase({
              auth: 'publishable',
              env: makeEnv(),
              onError: (error, _req, res) => {
                res.status(error.status).json({
                  status: error.status,
                  code: error.code,
                  message: error.message,
                })
              },
            }),
          )
          app.get('/', (_req, res) => res.json({ ok: true }))
        },
        (port) => fetchJson(port),
      )

      expect(result.status).toBe(401)
      const body = JSON.parse(result.body) as {
        status: number
        code: string
        message: string
      }
      expect(body.status).toBe(401)
      expect(body.code).toBe('INVALID_CREDENTIALS')
      expect(typeof body.message).toBe('string')
    })

    it('forwards a thrown error from onError via next(err)', async () => {
      const result = await withApp(
        (app) => {
          app.use(
            withSupabase({
              auth: 'publishable',
              env: makeEnv(),
              onError: () => {
                throw new Error('handler boom')
              },
            }),
          )
          app.get('/', (_req, res) => res.json({ ok: true }))
          app.use(reportGenericError)
        },
        (port) => fetchJson(port),
      )

      expect(result.status).toBe(500)
      const body = JSON.parse(result.body) as { error: string }
      expect(body.error).toBe('handler boom')
    })

    it('forwards a rejected promise from async onError via next(err)', async () => {
      const result = await withApp(
        (app) => {
          app.use(
            withSupabase({
              auth: 'publishable',
              env: makeEnv(),
              onError: async () => {
                await Promise.resolve()
                throw new Error('async handler boom')
              },
            }),
          )
          app.get('/', (_req, res) => res.json({ ok: true }))
          app.use(reportGenericError)
        },
        (port) => fetchJson(port),
      )

      expect(result.status).toBe(500)
      const body = JSON.parse(result.body) as { error: string }
      expect(body.error).toBe('async handler boom')
    })
  })

  describe('short-circuit', () => {
    it('skips auth when res.locals.supabaseContext is already set', async () => {
      const result = await withApp(
        (app) => {
          app.use(withSupabase({ auth: 'none', env: makeEnv() }))
          // Second middleware would require 'secret' — but should skip.
          app.use(withSupabase({ auth: 'secret', env: makeEnv() }))
          app.get('/', (_req, res) => {
            const ctx = res.locals.supabaseContext
            res.json({ authMode: ctx.authMode })
          })
        },
        // No apikey header — would fail 'secret' if it ran.
        (port) => fetchJson(port),
      )

      expect(result.status).toBe(200)
      expect(JSON.parse(result.body)).toEqual({ authMode: 'none' })
    })
  })
})
