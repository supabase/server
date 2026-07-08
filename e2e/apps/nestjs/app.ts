// Minimal NestJS app (Express platform) exercising @supabase/server from
// dist/ (not src/), with config read from process.env via resolveEnv().
// Unlike the supertest-driven integration tests, this listens on a real port.
import 'reflect-metadata'

import { Body, Controller, Get, Module, Post, UseGuards } from '@nestjs/common'
import { NestFactory } from '@nestjs/core'

import {
  SupabaseCtx,
  withSupabase,
} from '../../../dist/adapters/nestjs/index.mjs'
import type { SupabaseContext } from '../../../dist/index.mjs'
import { insertNote, listNotes } from '../notes.ts'

const UserGuard = withSupabase({ auth: 'user' })
const OptionalUserGuard = withSupabase({ auth: ['user', 'none'] })

@Controller()
class AppController {
  @Get('health')
  health() {
    return { status: 'ok' }
  }

  @Get('me')
  @UseGuards(UserGuard)
  me(@SupabaseCtx('userClaims') userClaims: SupabaseContext['userClaims']) {
    return { userClaims }
  }

  @Get('me-optional')
  @UseGuards(OptionalUserGuard)
  meOptional(
    @SupabaseCtx('userClaims') userClaims: SupabaseContext['userClaims'],
  ) {
    return { userClaims: userClaims ?? null }
  }

  @Get('notes')
  @UseGuards(UserGuard)
  list(@SupabaseCtx() ctx: SupabaseContext) {
    return listNotes(ctx.supabaseAdmin, ctx.userClaims!.id)
  }

  // Nest's default status for POST is already 201.
  @Post('notes')
  @UseGuards(UserGuard)
  create(@Body() dto: { body?: string }, @SupabaseCtx() ctx: SupabaseContext) {
    return insertNote(ctx.supabaseAdmin, ctx.userClaims!.id, dto.body ?? '')
  }
}

@Module({ controllers: [AppController] })
class AppModule {}

export async function start(port: number): Promise<() => Promise<void>> {
  const app = await NestFactory.create(AppModule, { logger: false })
  await app.listen(port)
  return () => app.close()
}
