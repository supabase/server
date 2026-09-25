import { Controller, Get, Req, UseGuards } from '@nestjs/common'
import type { Contributions } from '@supabase/middleware'
import { withRequiredClaims } from '@supabase/server/middleware/required-claims'
import { withSupabaseClient } from '@supabase/server/middleware/client'

import { toNestGuard } from './supabase.guard.js'

// `withRequiredClaims` answers 401 to any request without a valid user JWT,
// so the handlers below only run for signed-in callers. `withClaims` would
// let anonymous requests through with `jwtClaims: null`.
const entries = [withRequiredClaims(), withSupabaseClient()] as const

// One guard class for every route. `toNestGuard` folds the pipeline when it
// is called, so a single call keeps entry state shared across requests.
const SupabaseGuard = toNestGuard(entries)

@Controller('todos')
export class TodosController {
  @Get()
  @UseGuards(SupabaseGuard)
  async list(@Req() req: Contributions<typeof entries>) {
    const { data, error } = await req.supabase.from('todos').select()
    if (error) throw error
    return data
  }

  @Get('me')
  @UseGuards(SupabaseGuard)
  me(@Req() req: Contributions<typeof entries>) {
    return { id: req.jwtClaims.sub }
  }
}
