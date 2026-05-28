import type { SupabaseContext } from '../../types.js'

/**
 * Shape of the request object that NestJS adapter code reads and writes.
 * NestJS supports both Express and Fastify; the headers + url surface used
 * here is identical across both.
 *
 * Persistent storage on the request:
 * - `supabaseContext` — the full `SupabaseContext` written by the
 *   `withSupabase` guard.
 * - `gateContext` — a peer bag holding gate contributions, mutated by
 *   `asGuard` invocations. Distinct from `supabaseContext` so gates don't
 *   pollute the Supabase-only bag, and so `@SupabaseCtx` / `@GateCtx`
 *   decorators read from clearly separated spaces.
 */
export interface NestRequestLike {
  headers: Record<string, string | string[] | undefined>
  url?: string
  supabaseContext?: SupabaseContext
  gateContext?: Record<string, unknown>
}

/**
 * Adapts a NestJS-style request (Express or Fastify) into a Web `Request` so
 * the same auth primitives that drive the fetch-handler form can be used
 * here. Headers are copied with HTTP/2 pseudo-headers filtered out; the URL
 * uses a synthetic origin since callers only need it to be syntactically
 * valid.
 */
export function toWebRequest(req: NestRequestLike): Request {
  const headers = new Headers()
  for (const [name, value] of Object.entries(req.headers ?? {})) {
    // HTTP/2 pseudo-headers (`:method`, `:path`, …) leak into `req.headers`
    // under Fastify with HTTP/2. Web `Headers` rejects names starting with
    // a colon, so skip them — they aren't auth credentials anyway.
    if (name.startsWith(':')) continue
    if (Array.isArray(value)) headers.set(name, value.join(', '))
    else if (value != null) headers.set(name, String(value))
  }
  return new Request(`http://nestjs.local${req.url ?? '/'}`, { headers })
}
