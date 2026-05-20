import type { AddressInfo } from 'node:net'

import express, { type Express } from 'express'
import { describe, expect, it } from 'vitest'

import { toFetchRequest } from './to-fetch-request.js'

interface Capture {
  url: string
  method: string
  headers: Headers
  bodyText: string
}

async function withApp(
  configure: (app: Express) => void,
  run: (port: number) => Promise<void>,
): Promise<Capture> {
  const app = express()
  configure(app)

  let capture: Capture | undefined
  let captureError: unknown

  app.use(async (req, res) => {
    try {
      const fetchReq = toFetchRequest(req)
      const bodyText =
        fetchReq.method === 'GET' || fetchReq.method === 'HEAD'
          ? ''
          : await fetchReq.text()
      capture = {
        url: fetchReq.url,
        method: fetchReq.method,
        headers: fetchReq.headers,
        bodyText,
      }
      res.status(200).end()
    } catch (err) {
      captureError = err
      res.status(500).end()
    }
  })

  const server = app.listen(0)
  await new Promise<void>((resolve) => server.once('listening', resolve))
  const port = (server.address() as AddressInfo).port

  try {
    await run(port)
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()))
  }

  if (captureError) throw captureError
  if (!capture) throw new Error('Request was not captured')
  return capture
}

describe('toFetchRequest', () => {
  it('preserves headers case-insensitively', async () => {
    const cap = await withApp(
      () => undefined,
      async (port) => {
        await fetch(`http://127.0.0.1:${port}/`, {
          headers: {
            'X-Custom-Header': 'value',
            'X-Another-Header': 'foo',
          },
        })
      },
    )
    expect(cap.headers.get('x-custom-header')).toBe('value')
    expect(cap.headers.get('X-CUSTOM-HEADER')).toBe('value')
    expect(cap.headers.get('x-another-header')).toBe('foo')
  })

  it('forwards Authorization and apikey headers', async () => {
    const cap = await withApp(
      () => undefined,
      async (port) => {
        await fetch(`http://127.0.0.1:${port}/`, {
          headers: {
            Authorization: 'Bearer token123',
            apikey: 'sb_publishable_xyz',
          },
        })
      },
    )
    expect(cap.headers.get('authorization')).toBe('Bearer token123')
    expect(cap.headers.get('apikey')).toBe('sb_publishable_xyz')
  })

  it('preserves multi-value Cookie header', async () => {
    const cap = await withApp(
      () => undefined,
      async (port) => {
        await fetch(`http://127.0.0.1:${port}/`, {
          headers: {
            Cookie: 'session=abc; theme=dark; lang=en',
          },
        })
      },
    )
    const cookie = cap.headers.get('cookie') ?? ''
    expect(cookie).toContain('session=abc')
    expect(cookie).toContain('theme=dark')
    expect(cookie).toContain('lang=en')
  })

  it('composes absolute URL behind X-Forwarded-Proto when trust proxy is enabled', async () => {
    const cap = await withApp(
      (app) => app.set('trust proxy', true),
      async (port) => {
        await fetch(`http://127.0.0.1:${port}/path/here?q=1`, {
          headers: { 'X-Forwarded-Proto': 'https' },
        })
      },
    )
    expect(cap.url.startsWith('https://')).toBe(true)
    expect(cap.url).toContain('/path/here?q=1')
  })

  it('uses http scheme when trust proxy is disabled', async () => {
    const cap = await withApp(
      () => undefined,
      async (port) => {
        await fetch(`http://127.0.0.1:${port}/`, {
          headers: { 'X-Forwarded-Proto': 'https' },
        })
      },
    )
    expect(cap.url.startsWith('http://')).toBe(true)
    expect(cap.url.startsWith('https://')).toBe(false)
  })

  it('forwards POST body when no parser middleware is registered', async () => {
    const cap = await withApp(
      () => undefined,
      async (port) => {
        await fetch(`http://127.0.0.1:${port}/`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ hello: 'world' }),
        })
      },
    )
    expect(cap.method).toBe('POST')
    expect(cap.bodyText).toBe('{"hello":"world"}')
  })

  it('re-serializes a parsed JSON body when express.json() is registered', async () => {
    const cap = await withApp(
      (app) => {
        app.use(express.json())
      },
      async (port) => {
        await fetch(`http://127.0.0.1:${port}/`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ a: 1, b: 'two' }),
        })
      },
    )
    expect(cap.method).toBe('POST')
    expect(JSON.parse(cap.bodyText)).toEqual({ a: 1, b: 'two' })
  })
})
