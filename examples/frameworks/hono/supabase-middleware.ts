import type { Context, MiddlewareHandler, Next } from 'hono'
import { createMiddleware } from 'hono/factory'
import { bufferRequest, pipeline, seedContext } from '@supabase/middleware'
import type {
  AnyEntry,
  Contributions,
  ValidateEntries,
} from '@supabase/middleware'

/**
 * The Hono middleware type when the entries compose, or the engine's error
 * string when they do not. The string surfaces the `middleware-conflict` or
 * `middleware-prereq` message at the `app.use` call.
 */
type Bridge<Entries extends readonly AnyEntry[]> = [
  ValidateEntries<Entries>,
] extends [true]
  ? MiddlewareHandler<{ Variables: Contributions<Entries> }>
  : ValidateEntries<Entries>

/** Per-request handoff from the Hono middleware to the pipeline's terminal. */
const HANDOFF = Symbol('toHono.handoff')
interface Handoff {
  c: Context
  next: Next
}

/**
 * Runs an entry array inside Hono's middleware slot.
 *
 * The pipeline folds once, when `toHono` is called, so entries keep their
 * state across requests. Each request travels through the fold with its Hono
 * context under a symbol key, which the engine's context spreads preserve.
 *
 * The terminal publishes every contributed key onto `c.var`, runs the rest of
 * the Hono chain, and returns Hono's real response back up through the
 * entries. That return is what lets response-phase entries such as `withCors`
 * stamp headers on the way out.
 *
 * Register the result with `.use()` before the routes it gates. Hono applies
 * middleware only to routes registered after it.
 */
export function toHono<const Entries extends readonly AnyEntry[]>(
  entries: Entries,
): Bridge<Entries> {
  const run = pipeline(entries as readonly AnyEntry[], async (_req, ctx) => {
    const { c, next } = (ctx as Record<symbol, Handoff>)[HANDOFF]
    for (const [key, value] of Object.entries(ctx)) {
      c.set(key as never, value as never)
    }
    await next()
    return c.res
  })

  return createMiddleware(async (c, next) => {
    // The engine buffers a request body only when it seeds the context
    // itself. This bridge seeds, so it buffers too, and puts the proxy on
    // Hono's request so an entry and the route read the same cached body.
    if (c.req.raw.body) c.req.raw = bufferRequest(c.req.raw)
    // `c.env` holds the platform bindings on Cloudflare Workers, which is how
    // `getEnv` inside the entries reads `SUPABASE_URL` there. On Node it holds
    // the raw request pair and `getEnv` falls back to `process.env`.
    const res = await run(c.req.raw, {
      ...seedContext(c.env),
      [HANDOFF]: { c, next } satisfies Handoff,
    })
    if (res !== c.res) {
      // Hono's `res` setter copies the previous response's headers onto the
      // new one, which reverts any header the response phase rewrote.
      // Clearing first makes the assignment authoritative.
      c.res = undefined as never
      c.res = res
    }
  }) as never
}
