/**
 * Hono framework adapter for `@supabase/server`.
 *
 * The top-level {@link withSupabase} is built for the raw Web API `Request`/`Response`
 * standard. Frameworks like Hono wrap that standard with their own abstractions
 * (context objects, middleware chains, typed variables). This adapter bridges the
 * gap — same auth and client creation, delivered through `c.var.supabaseContext`.
 *
 * @example
 * ```ts
 * import { Hono } from 'hono'
 * import { withSupabase } from '@supabase/server/adapters/hono'
 *
 * const app = new Hono()
 * app.use('*', withSupabase({ allow: 'user' }))
 *
 * app.get('/items', async (c) => {
 *   const { supabase } = c.var.supabaseContext
 *   const { data } = await supabase.rpc('list_items')
 *   return c.json(data)
 * })
 *
 * export default { fetch: app.fetch }
 * ```
 *
 * @packageDocumentation
 */

export { withSupabase } from './middleware.js'
