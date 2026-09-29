import { createServerFn } from '@tanstack/react-start'
import { withRequiredClaims } from '@supabase/server/middleware/required-claims'
import { withSupabaseClient } from '@supabase/server/middleware/client'

import { toTanStackStart } from './supabase-middleware.js'

// `withRequiredClaims` answers 401 to any request without a valid user JWT,
// so the server functions below only run for signed-in callers. `withClaims`
// would let anonymous requests through with `jwtClaims: null`.
const supabase = toTanStackStart([withRequiredClaims(), withSupabaseClient()])

export const getTodos = createServerFn()
  .middleware([supabase])
  .handler(async ({ context }) => {
    const { data, error } = await context.supabase.from('todos').select()
    if (error) throw error
    return data
  })

export const whoAmI = createServerFn()
  .middleware([supabase])
  .handler(async ({ context }) => ({ id: context.jwtClaims.sub }))
