import { Hono } from 'hono'
import { withRequiredClaims } from '@supabase/server/middleware/required-claims'
import { withSupabaseClient } from '@supabase/server/middleware/client'

import { toHono } from './supabase-middleware.js'

// `withRequiredClaims` answers 401 to any request without a valid user JWT,
// so the routes below only run for signed-in callers. `withClaims` would let
// anonymous requests through with `jwtClaims: null`.
const app = new Hono()
  .use('*', toHono([withRequiredClaims(), withSupabaseClient()]))
  .get('/todos', async (c) => {
    const { data, error } = await c.var.supabase.from('todos').select()
    if (error) return c.json({ error: error.message }, 500)
    return c.json(data)
  })
  .get('/me', (c) => c.json({ id: c.var.jwtClaims.sub }))

export default { fetch: app.fetch }
