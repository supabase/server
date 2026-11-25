// Minimal NestJS app (Express platform) exercising @supabase/server from
// dist/ (not src/) through the Nest guard bridge in examples/frameworks/ —
// the same file consumers copy into their own projects. Config is read from
// process.env via resolveEnv(); this listens on a real port.
import 'reflect-metadata'

import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Module,
  Post,
  Req,
  UseGuards,
} from '@nestjs/common'
import { NestFactory } from '@nestjs/core'
import type { Contributions } from '@supabase/middleware'

import { toNestGuard } from '../../../examples/frameworks/nestjs/supabase.guard.ts'
import { withSupabaseAdminClient } from '../../../dist/middleware/admin-client/index.mjs'
import { withClaims } from '../../../dist/middleware/claims/index.mjs'
import { withSupabaseClient } from '../../../dist/middleware/client/index.mjs'
import { withRequiredClaims } from '../../../dist/middleware/required-claims/index.mjs'
import { toUserClaims } from '../claims.ts'
import { insertNote, listAllNotes, listNotes, listOwnNotes } from '../notes.ts'

// `withRequiredClaims` rejects a missing or invalid JWT before the handler
// runs — the gate `auth: 'user'` applied. `withClaims` lets an anonymous
// request through with `jwtClaims: null`, which is what `auth: ['user',
// 'none']` did. Both contribute `jwtClaims`, so they cannot share an array.
const gatedEntries = [
  withRequiredClaims(),
  withSupabaseClient(),
  withSupabaseAdminClient(),
] as const
const optionalEntries = [withClaims()] as const

type Gated = Contributions<typeof gatedEntries>
type Optional = Contributions<typeof optionalEntries>

// Each guard folds its pipeline once, so both are built at module scope and
// reused on every route.
const GatedGuard = toNestGuard(gatedEntries)
const OptionalGuard = toNestGuard(optionalEntries)

@Controller()
class AppController {
  @Get('health')
  health() {
    return { status: 'ok' }
  }

  @Get('me')
  @UseGuards(GatedGuard)
  me(@Req() req: Gated) {
    return { userClaims: toUserClaims(req.jwtClaims) }
  }

  @Get('me-optional')
  @UseGuards(OptionalGuard)
  meOptional(@Req() req: Optional) {
    return { userClaims: toUserClaims(req.jwtClaims) }
  }

  @Get('notes')
  @UseGuards(GatedGuard)
  list(@Req() req: Gated) {
    return listNotes(req.supabaseAdmin, req.jwtClaims.sub)
  }

  // User-scoped client: RLS does the scoping, no WHERE clause.
  @Get('my-notes')
  @UseGuards(GatedGuard)
  listOwn(@Req() req: Gated) {
    return listOwnNotes(req.supabase)
  }

  // Admin client, no filter: sees every user's rows regardless of caller.
  @Get('all-notes')
  @UseGuards(GatedGuard)
  listAll(@Req() req: Gated) {
    return listAllNotes(req.supabaseAdmin)
  }

  // Nest's default status for POST is already 201.
  @Post('notes')
  @UseGuards(GatedGuard)
  create(@Body() dto: { body?: string }, @Req() req: Gated) {
    if (!dto?.body) throw new BadRequestException('body required')
    return insertNote(req.supabaseAdmin, req.jwtClaims.sub, dto.body)
  }
}

@Module({ controllers: [AppController] })
class AppModule {}

export async function start(port: number): Promise<() => Promise<void>> {
  const app = await NestFactory.create(AppModule, { logger: false })
  await app.listen(port)
  return () => app.close()
}
