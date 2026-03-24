/**
 * Hono framework adapter for `@supabase/edge-functions`.
 *
 * Provides a Hono middleware version of {@link withSupabase} that stores the
 * {@link SupabaseContext} in `c.var.supabaseContext`.
 *
 * @example
 * ```ts
 * import { Hono } from 'hono'
 * import { withSupabase } from '@supabase/edge-functions/adapters/hono'
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
