/**
 * Express framework adapter for `@supabase/server`.
 *
 * @packageDocumentation
 */

export { withSupabase } from './middleware.js'
export type {
  ExpressAuthErrorHandler,
  WithSupabaseExpressConfig,
} from './middleware.js'
export { requireAuth } from './require-auth.js'
export { withSupabaseRoute } from './with-supabase-route.js'
export type { SupabaseRouteHandler } from './with-supabase-route.js'
