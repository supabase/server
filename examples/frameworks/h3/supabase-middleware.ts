import { defineMiddleware, toResponse } from 'h3'
import type { H3Event, Middleware } from 'h3'
import { bufferRequest, pipeline, seedContext } from '@supabase/middleware'
import type { AnyEntry, ValidateEntries } from '@supabase/middleware'

/**
 * The H3 middleware type when the entries compose, or the engine's error
 * string when they do not. The string surfaces the `middleware-conflict` or
 * `middleware-prereq` message at the `app.use` call.
 */
type Bridge<Entries extends readonly AnyEntry[]> = [
  ValidateEntries<Entries>,
] extends [true]
  ? Middleware
  : ValidateEntries<Entries>

/** Per-request handoff from the H3 middleware to the pipeline's terminal. */
const HANDOFF = Symbol('toH3.handoff')
interface Handoff {
  event: H3Event
  next: () => unknown
}

/**
 * Runs an entry array inside H3's middleware slot.
 *
 * The pipeline folds once, when `toH3` is called, so entries keep their state
 * across requests. Each request travels through the fold with its H3 event
 * under a symbol key, which the engine's context spreads preserve.
 *
 * The terminal copies every contributed key onto `event.context`, runs the
 * rest of the H3 chain, and returns the downstream response back up through
 * the entries. `event.context` is not generic, so read contributions through
 * `Contributions<typeof entries>` at the call site.
 */
export function toH3<const Entries extends readonly AnyEntry[]>(
  entries: Entries,
): Bridge<Entries> {
  const run = pipeline(entries as readonly AnyEntry[], async (_req, ctx) => {
    const { event, next } = (ctx as Record<symbol, Handoff>)[HANDOFF]
    for (const [key, value] of Object.entries(ctx)) {
      event.context[key] = value
    }
    // H3 handlers may return plain values. Normalizing here means the
    // response phase always receives a real Response.
    return toResponse(await next(), event)
  })

  return defineMiddleware((event, next) => {
    // The engine buffers a request body only when it seeds the context
    // itself. This bridge seeds, so it buffers too. `event.req` is readonly in
    // H3's types and a plain property at runtime; the cast puts the proxy on
    // the event so an entry and the route read the same cached body.
    if (event.req.body) {
      ;(event as { req: H3Event['req'] }).req = bufferRequest(
        event.req,
      ) as H3Event['req']
    }
    // On Cloudflare Workers the bindings live on the request's runtime info,
    // which is how `getEnv` inside the entries reads `SUPABASE_URL` there. On
    // Node the value is undefined and `getEnv` falls back to `process.env`.
    return run(event.req, {
      ...seedContext(event.req.runtime?.cloudflare?.env),
      [HANDOFF]: { event, next } satisfies Handoff,
    })
  }) as never
}
