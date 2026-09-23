import { Elysia } from 'elysia'
import { pipeline } from '@supabase/middleware'
import type {
  AnyEntry,
  Contributions,
  FetchHandler,
  ValidateEntries,
} from '@supabase/middleware'

/**
 * The `handle` parameter type when the entries compose, or the engine's error
 * string when they do not. Placing the check on the parameter surfaces the
 * `middleware-conflict` or `middleware-prereq` message at the `wrapElysia`
 * call, the same way `pipeline` reports it on its handler argument.
 */
type Handle<Entries extends readonly AnyEntry[]> = [
  ValidateEntries<Entries>,
] extends [true]
  ? (req: Request) => Response | Promise<Response>
  : ValidateEntries<Entries>

/** Contributions for an in-flight request, keyed by the Request Elysia sees. */
const HANDOFF = new WeakMap<Request, Record<string, unknown>>()

/**
 * Elysia plugin that exposes the entries' contributions on the route context.
 *
 * `supabaseCtx` and `wrapElysia` are one unit. The wrapper runs the entries
 * and stores their contributions for the request; the plugin reads them. When
 * the wrapper did not run, the entries did not run either, so the plugin
 * throws instead of handing the route an empty context. An app served with
 * `app.listen()` or `export default app` therefore fails closed on every
 * route.
 *
 * `Entries` is type-only. Pass the type of the same tuple `wrapElysia`
 * receives, so route handlers see the keys that tuple contributes.
 */
export function supabaseCtx<const Entries extends readonly AnyEntry[]>() {
  return new Elysia()
    .resolve((c) => {
      const contributions = HANDOFF.get(c.request)
      if (!contributions) {
        throw new Error(
          'supabaseCtx() ran without wrapElysia(). The entries did not run, ' +
            'so this request is not gated. Serve the app through ' +
            '`wrapElysia(entries, (req) => app.handle(req))`.',
        )
      }
      return contributions as Contributions<Entries>
    })
    .as('scoped')
}

/**
 * Wraps the whole app so the entries see the real outgoing Response.
 *
 * Elysia's lifecycle hooks run in the request phase only: a `.resolve()` hook
 * has no `next()` and never sees the response. Composing around `app.handle`
 * keeps the response phase for entries such as `withCors`. Because the
 * entries wrap the whole app, they apply app-wide; scope per route with
 * Elysia's own `.group()` and a separately wrapped sub-app.
 *
 * Pair it with `supabaseCtx`, which reads what this wrapper stores.
 */
export function wrapElysia<const Entries extends readonly AnyEntry[]>(
  entries: Entries,
  handle: Handle<Entries>,
): FetchHandler {
  const next = handle as (req: Request) => Response | Promise<Response>
  return pipeline(entries as readonly AnyEntry[], async (req, ctx) => {
    const contributions: Record<string, unknown> = {}
    for (const [key, value] of Object.entries(ctx)) {
      contributions[key] = value
    }
    HANDOFF.set(req, contributions)
    try {
      return await next(req)
    } finally {
      // The WeakMap already permits collection. The delete keeps the entry
      // from outliving the request when the Request object is retained.
      HANDOFF.delete(req)
    }
  })
}
