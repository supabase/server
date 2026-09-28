import { createMiddleware } from '@tanstack/react-start'
import { pipeline, seedContext } from '@supabase/middleware'
import type {
  AnyEntry,
  Contributions,
  ValidateEntries,
} from '@supabase/middleware'

/**
 * Resolves to `unknown` when the entries compose, so the parameter type stays
 * `Entries`. Otherwise it is the engine's error string, and the intersection
 * makes the call fail with the `middleware-conflict` or `middleware-prereq`
 * message.
 */
type Validated<Entries extends readonly AnyEntry[]> = [
  ValidateEntries<Entries>,
] extends [true]
  ? unknown
  : ValidateEntries<Entries>

/** Per-request handoff from the Start middleware to the pipeline's terminal. */
const HANDOFF = Symbol('toTanStackStart.handoff')
interface Handoff {
  next: (options: { context: Record<string, unknown> }) => unknown
  ran: boolean
}

/**
 * Makes the body of `request` readable more than once, in place.
 *
 * The first reader drains the stream into a cache and every later reader is
 * served from it, so an entry and the route handler both see the body. The
 * engine's `bufferRequest` returns a wrapped `Request` instead, which does
 * not fit here: a request middleware's `next()` accepts `context` only, and
 * Start hands the route handler the same `Request` the middleware saw, so
 * the readers go onto that object.
 */
function bufferInPlace(request: Request): void {
  if (!request.body) return
  const readOnce = request.arrayBuffer.bind(request)
  let buffer: Promise<ArrayBuffer> | undefined
  const arrayBuffer = () => (buffer ??= readOnce())
  const text = async () => new TextDecoder().decode(await arrayBuffer())
  const readers = {
    arrayBuffer,
    text,
    json: async () => JSON.parse(await text()) as unknown,
    bytes: async () => new Uint8Array(await arrayBuffer()),
    blob: async () => new Blob([await arrayBuffer()]),
    formData: async () =>
      new Response(await arrayBuffer(), {
        headers: request.headers,
      }).formData(),
    // Every reader is cached, so the request is its own clone.
    clone: () => request,
  }
  for (const [name, value] of Object.entries(readers)) {
    Object.defineProperty(request, name, { value, configurable: true })
  }
}

/**
 * Runs an entry array as a TanStack Start request middleware.
 *
 * The pipeline folds once, when `toTanStackStart` is called, so entries keep
 * their state across requests. Each request travels through the fold with
 * Start's `next` under a symbol key, which the engine's context spreads
 * preserve. The terminal hands the contributions to Start as the server
 * context and returns the downstream response back up through the entries.
 *
 * `.server<Contributions<Entries>>` is what types `context` downstream. The
 * generic has no constraint, so leaving it off types the context as
 * `undefined`.
 *
 * On a server function, Start's fetcher returns any JSON body as the call's
 * value without checking the status, so a 401 from `withRequiredClaims` would
 * resolve the caller's promise with `{ message, code }`. A short-circuit on a
 * server function is therefore rethrown as an error carrying `status` and
 * `code`. Server routes get the `Response` back unchanged.
 */
export function toTanStackStart<const Entries extends readonly AnyEntry[]>(
  entries: Entries & Validated<Entries>,
) {
  const run = pipeline(entries as readonly AnyEntry[], async (_req, ctx) => {
    const handoff = (ctx as Record<symbol, Handoff>)[HANDOFF]
    handoff.ran = true
    const context: Record<string, unknown> = {}
    for (const [key, value] of Object.entries(ctx)) {
      context[key] = value
    }
    const result = (await handoff.next({ context })) as { response: Response }
    return result.response
  })

  return createMiddleware({ type: 'request' }).server<Contributions<Entries>>(
    async ({ request, next, handlerType }) => {
      // The engine buffers a request body only when it seeds the context
      // itself. This bridge seeds, so it buffers too.
      bufferInPlace(request)
      const handoff: Handoff = { next, ran: false }
      const response = await run(request, {
        ...seedContext(),
        [HANDOFF]: handoff,
      })
      if (handoff.ran || handlerType !== 'serverFn') return response

      const body = (await response
        .clone()
        .json()
        .catch(() => null)) as { message?: string; code?: string } | null
      throw Object.assign(
        new Error(
          body?.message ?? `Request failed with status ${response.status}`,
        ),
        {
          status: response.status,
          statusCode: response.status,
          ...(body?.code !== undefined && { code: body.code }),
        },
      )
    },
  )
}
