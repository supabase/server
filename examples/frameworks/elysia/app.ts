import { Elysia } from 'elysia'
import { withRequiredClaims } from '@supabase/server/middleware/required-claims'
import { withSupabaseClient } from '@supabase/server/middleware/client'

import { supabaseCtx, wrapElysia } from './supabase-middleware.js'

// `withRequiredClaims` answers 401 to any request without a valid user JWT,
// so the routes below only run for signed-in callers. `withClaims` would let
// anonymous requests through with `jwtClaims: null`.
const entries = [withRequiredClaims(), withSupabaseClient()] as const

const app = new Elysia()
  .use(supabaseCtx<typeof entries>())
  .get('/todos', async (c) => {
    const { data, error } = await c.supabase.from('todos').select()
    if (error) throw error
    return data
  })
  .get('/me', (c) => ({ id: c.jwtClaims.sub }))

export default {
  fetch: wrapElysia(entries, (req) => app.handle(req)),
}
