import { H3 } from 'h3'
import type { Contributions } from '@supabase/middleware'
import { withRequiredClaims } from '@supabase/server/middleware/required-claims'
import { withSupabaseClient } from '@supabase/server/middleware/client'

import { toH3 } from './supabase-middleware.js'

// `withRequiredClaims` answers 401 to any request without a valid user JWT,
// so the routes below only run for signed-in callers. `withClaims` would let
// anonymous requests through with `jwtClaims: null`.
const entries = [withRequiredClaims(), withSupabaseClient()] as const

const app = new H3()
app.use(toH3(entries))

app.get('/todos', async (event) => {
  const { supabase } = event.context as Contributions<typeof entries>
  const { data, error } = await supabase.from('todos').select()
  if (error) throw error
  return data
})

app.get('/me', (event) => {
  const { jwtClaims } = event.context as Contributions<typeof entries>
  return { id: jwtClaims.sub }
})

export default { fetch: app.fetch }
