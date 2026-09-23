import { HttpException, Injectable } from '@nestjs/common'
import type { CanActivate, ExecutionContext, Type } from '@nestjs/common'
import { pipeline, seedContext } from '@supabase/middleware'
import type { AnyEntry, ValidateEntries } from '@supabase/middleware'

/**
 * The guard class when the entries compose, or the engine's error string when
 * they do not. The string surfaces the `middleware-conflict` or
 * `middleware-prereq` message at the `@UseGuards` call.
 */
type Bridge<Entries extends readonly AnyEntry[]> = [
  ValidateEntries<Entries>,
] extends [true]
  ? Type<CanActivate>
  : ValidateEntries<Entries>

interface NestRequestLike {
  headers: Record<string, string | string[] | undefined>
  method?: string
  url?: string
}

/** The header writer Express and Fastify both expose on their response. */
interface NestResponseLike {
  header(name: string, value: string | string[]): unknown
}

/**
 * Methods the Fetch standard forbids on `Request`. Nest still routes them, so
 * the Web request carries `GET` for these and the entries run.
 */
const FORBIDDEN_METHODS = new Set(['CONNECT', 'TRACE', 'TRACK'])

/**
 * Request properties Nest's parameter decorators read, from `@nestjs/core`'s
 * `route-params-factory`: `@Body()`, `@Query()`, `@Param()`, `@Headers()`,
 * `@Session()`, `@UploadedFile()`, `@UploadedFiles()`, `@HostParam()`,
 * `@Ip()`, and `@RawBody()`. A contribution under one of these names would
 * change what a controller receives, so the guard refuses it.
 */
const RESERVED_KEYS = new Set([
  'body',
  'rawBody',
  'params',
  'hosts',
  'query',
  'headers',
  'session',
  'file',
  'files',
  'ip',
])

/**
 * Headers that describe the body. Nest serializes the reply body itself, so
 * these would not match it.
 */
const BODY_FRAMING_HEADERS = new Set([
  'content-length',
  'content-encoding',
  'transfer-encoding',
])

/**
 * Builds a Web `Request` from Nest's platform request. Headers and method
 * carry across; the body does not, so entries that read it do not work
 * through this bridge.
 */
function toWebRequest(req: NestRequestLike): Request {
  const headers = new Headers()
  for (const [name, value] of Object.entries(req.headers ?? {})) {
    // HTTP/2 pseudo-headers (`:method`, `:path`) are invalid Web header names.
    if (name.startsWith(':')) continue
    if (Array.isArray(value)) headers.set(name, value.join(', '))
    else if (value != null) headers.set(name, String(value))
  }
  // Middleware that branch on the method, such as CORS preflight detection,
  // need it carried across.
  const method = req.method?.toUpperCase() ?? 'GET'
  return new Request(`http://nestjs.local${req.url ?? '/'}`, {
    method: FORBIDDEN_METHODS.has(method) ? 'GET' : method,
    headers,
  })
}

/** Per-request capture from the pipeline's terminal back to the guard. */
const CAPTURE = Symbol('toNestGuard.capture')
interface Capture {
  ran: boolean
  contributions: Record<string, unknown>
}

/**
 * Runs an entry array as a Nest guard.
 *
 * A guard covers context and short-circuit. On a short-circuit the guard
 * copies the entry's headers onto the platform response and throws an
 * `HttpException` with the entry's status and body, so `WWW-Authenticate`,
 * CORS, and `Set-Cookie` headers reach the client. The response phase is not
 * available: Nest's interceptors receive the controller's return value, not a
 * `Response`, so there is nothing for a generator entry's `yield` to act on.
 *
 * The pipeline folds once, when `toNestGuard` is called, so entries keep
 * their state across requests. Call it once and reuse the class on every
 * route. Each request travels through the fold with a capture box under a
 * symbol key, which the engine's context spreads preserve. The terminal marks
 * the box and records the contributions; the guard then copies them onto
 * Nest's request object as flat keys.
 *
 * One guard per request. A contribution whose key already exists on the
 * request, or names a property Nest's parameter decorators read, throws
 * instead of overwriting. A second `toNestGuard` on the same route finds the
 * first one's keys and throws too, so put every entry in one array.
 */
export function toNestGuard<const Entries extends readonly AnyEntry[]>(
  entries: Entries,
): Bridge<Entries> {
  const run = pipeline(entries as readonly AnyEntry[], async (_req, ctx) => {
    const capture = (ctx as Record<symbol, Capture>)[CAPTURE]
    capture.ran = true
    for (const [key, value] of Object.entries(ctx)) {
      capture.contributions[key] = value
    }
    return new Response(null, { status: 204 })
  })

  class EntriesGuard implements CanActivate {
    async canActivate(ec: ExecutionContext): Promise<boolean> {
      if (ec.getType() !== 'http') {
        throw new HttpException(
          {
            message: 'Supabase middleware only supports HTTP contexts.',
            code: 'unsupported_context',
          },
          500,
        )
      }

      const http = ec.switchToHttp()
      const req = http.getRequest<NestRequestLike & Record<string, unknown>>()
      const capture: Capture = { ran: false, contributions: {} }
      const res = await run(toWebRequest(req), {
        ...seedContext(),
        [CAPTURE]: capture,
      })

      if (!capture.ran) {
        // An entry short-circuited. `HttpException` carries status and body
        // only, so the headers go onto the platform response first.
        const platformRes = http.getResponse<NestResponseLike>()
        res.headers.forEach((value, name) => {
          if (name === 'set-cookie' || BODY_FRAMING_HEADERS.has(name)) return
          platformRes.header(name, value)
        })
        const cookies = res.headers.getSetCookie()
        if (cookies.length > 0) platformRes.header('set-cookie', cookies)
        // Nest wraps a string body into `{ statusCode, message }`, so the
        // parsed object is what keeps the `{ message, code }` payload intact.
        const text = await res.text()
        let body: string | Record<string, unknown> = text
        try {
          body = JSON.parse(text) as Record<string, unknown>
        } catch {
          // A non-JSON short-circuit body is passed through as text.
        }
        throw new HttpException(body, res.status)
      }

      for (const key of Object.keys(capture.contributions)) {
        if (RESERVED_KEYS.has(key) || key in req) {
          throw new Error(
            `Middleware contribution "${key}" collides with a property of ` +
              "Nest's request. Give the entry a different key.",
          )
        }
      }
      Object.assign(req, capture.contributions)
      return true
    }
  }

  // Applied as a call rather than decorator syntax, so the file also works
  // without a decorator transform.
  Injectable()(EntriesGuard)
  return EntriesGuard as never
}
