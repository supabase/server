import { Readable } from 'node:stream'

import type { Request as ExpressRequest } from 'express'

type RequestInitWithDuplex = RequestInit & { duplex?: 'half' }

/**
 * Translate an Express {@link ExpressRequest} into a Fetch {@link Request}.
 *
 * Internal helper consumed by the Express adapter middleware. Not exported
 * from the public adapter barrel.
 *
 * - URL is built from `req.protocol` + `req.get('host')` + `req.originalUrl`
 *   (falls back to `req.url`). `req.protocol` already respects `trust proxy`
 *   and `X-Forwarded-Proto` when the app opts in.
 * - All headers are copied from `req.rawHeaders` so repeated values
 *   (e.g., multiple `Cookie` headers) are preserved.
 * - For non-`GET`/`HEAD` methods, the body is forwarded. If a parser
 *   middleware populated `req.body`, the parsed value is re-serialized;
 *   otherwise the raw {@link Readable} stream is streamed through.
 */
export function toFetchRequest(req: ExpressRequest): Request {
  const host = req.get('host') ?? 'localhost'
  const protocol = req.protocol || 'http'
  const path = req.originalUrl || req.url || '/'
  const url = `${protocol}://${host}${path}`

  const headers = new Headers()
  const raw = req.rawHeaders
  for (let i = 0; i < raw.length; i += 2) {
    const name = raw[i]
    const value = raw[i + 1]
    if (name !== undefined && value !== undefined) {
      headers.append(name, value)
    }
  }

  const method = (req.method ?? 'GET').toUpperCase()

  if (method === 'GET' || method === 'HEAD') {
    return new Request(url, { method, headers })
  }

  const init: RequestInitWithDuplex = { method, headers }
  const parsed: unknown = (req as ExpressRequest & { body?: unknown }).body

  if (parsed === undefined || parsed === null) {
    init.body = Readable.toWeb(req) as ReadableStream<Uint8Array>
    init.duplex = 'half'
  } else if (typeof parsed === 'string') {
    init.body = parsed
  } else if (parsed instanceof Uint8Array) {
    init.body = parsed as BodyInit
  } else if (parsed instanceof ArrayBuffer) {
    init.body = parsed
  } else {
    init.body = JSON.stringify(parsed)
    if (!headers.has('content-type')) {
      headers.set('content-type', 'application/json')
    }
  }

  return new Request(url, init)
}
