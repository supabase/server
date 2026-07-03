import {
  createParamDecorator,
  type ExecutionContext,
  type PipeTransform,
  type Type,
} from '@nestjs/common'

import type { SupabaseContext } from '../../types.js'

/**
 * NestJS param decorator that returns the {@link SupabaseContext} attached
 * by `withSupabase()`. Pass a key (e.g. `'supabase'`, `'userClaims'`) to pull
 * a single field, or no argument to receive the whole context.
 *
 * @example
 * ```ts
 * import { Controller, Get, UseGuards } from '@nestjs/common'
 * import { withSupabase, SupabaseCtx } from '@supabase/server/adapters/nestjs'
 * import type { SupabaseContext } from '@supabase/server'
 *
 * @Controller('games')
 * @UseGuards(withSupabase({ auth: 'user' }))
 * export class GamesController {
 *   @Get()
 *   list(@SupabaseCtx() ctx: SupabaseContext) {
 *     return ctx.supabase.from('favorite_games').select()
 *   }
 *
 *   @Get('me')
 *   me(@SupabaseCtx('userClaims') user: SupabaseContext['userClaims']) {
 *     return user
 *   }
 * }
 * ```
 *
 * @category Adapters
 */
export const SupabaseCtx: (
  data?: keyof SupabaseContext,
  ...pipes: (Type<PipeTransform> | PipeTransform)[]
) => ParameterDecorator = createParamDecorator(
  (data: keyof SupabaseContext | undefined, ctx: ExecutionContext) => {
    const req = ctx
      .switchToHttp()
      .getRequest<{ supabaseContext?: SupabaseContext }>()
    const supabaseContext = req.supabaseContext
    if (data) return supabaseContext?.[data]
    return supabaseContext
  },
)
