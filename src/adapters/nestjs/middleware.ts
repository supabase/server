import {
  HttpException,
  Injectable,
  type CanActivate,
  type ExecutionContext,
  type Type,
} from '@nestjs/common'

import { createSupabaseContext } from '../../create-supabase-context.js'
import type { SupabaseContext, WithSupabaseConfig } from '../../types.js'

/**
 * Shape of the request object that the guard reads and writes. NestJS supports
 * both Express and Fastify; the headers + url surface used here is identical
 * across both.
 */
interface NestRequestLike {
  headers: Record<string, string | string[] | undefined>
  url?: string
  supabaseContext?: SupabaseContext
}

function toWebRequest(req: NestRequestLike): Request {
  const headers = new Headers()
  for (const [name, value] of Object.entries(req.headers ?? {})) {
    // HTTP/2 pseudo-headers (`:method`, `:path`, …) leak into `req.headers`
    // under Fastify with HTTP/2. Web `Headers` rejects names starting with
    // a colon, so skip them — they aren't auth credentials anyway.
    if (name.startsWith(':')) continue
    if (Array.isArray(value)) headers.set(name, value.join(', '))
    else if (value != null) headers.set(name, String(value))
  }
  // The URL only needs to be syntactically valid — `extractCredentials` reads
  // headers only, not the URL. We still pass `req.url` when available so any
  // future URL-aware primitives keep working.
  return new Request(`http://nestjs.local${req.url ?? '/'}`, { headers })
}

/**
 * NestJS guard that creates a {@link SupabaseContext} and stores it on the
 * underlying request as `request.supabaseContext`.
 *
 * **HTTP-only.** The guard reads HTTP headers via `switchToHttp()` and throws
 * if applied to an RPC or WebSocket handler — those transports must
 * authenticate via context-specific mechanisms.
 *
 * Always runs, even if a previous guard already set the context. This matches
 * Nest's guard order (global → controller → handler), so handler-level guards
 * can tighten what a global guard set rather than being skipped.
 *
 * Throws `HttpException` on auth failure — the original `AuthError` is
 * available via `cause`.
 *
 * @param config - Auth modes and optional environment overrides. CORS is excluded —
 *   use NestJS's built-in CORS (`app.enableCors()`).
 * @returns A guard class that can be passed to `@UseGuards(...)`.
 *
 * @example App-wide auth via `app.useGlobalGuards()`
 * ```ts
 * import { NestFactory } from '@nestjs/core'
 * import { withSupabase } from '@supabase/server/adapters/nestjs'
 *
 * const app = await NestFactory.create(AppModule)
 * app.useGlobalGuards(new (withSupabase({ auth: 'user' }))())
 * await app.listen(3000)
 * ```
 *
 * @example Per-route auth via `@UseGuards(...)`
 * ```ts
 * import { Controller, Get, UseGuards } from '@nestjs/common'
 * import { withSupabase, SupabaseCtx } from '@supabase/server/adapters/nestjs'
 * import type { SupabaseContext } from '@supabase/server'
 *
 * @Controller('games')
 * export class GamesController {
 *   @Get()
 *   @UseGuards(withSupabase({ auth: 'user' }))
 *   async list(@SupabaseCtx() ctx: SupabaseContext) {
 *     const { data } = await ctx.supabase.from('favorite_games').select()
 *     return data
 *   }
 * }
 * ```
 *
 * @category Adapters
 */
export function withSupabase(
  config?: Omit<WithSupabaseConfig, 'cors'>,
): Type<CanActivate> {
  // Applied programmatically rather than as an `@Injectable()` decorator:
  // the build tool (tsdown/oxc) does not lower legacy `experimentalDecorators`,
  // so decorator syntax here would ship verbatim to `dist` and fail to parse
  // under plain Node (CJS/ESM) at load time. Calling the decorator factory on
  // the class produces identical DI metadata. See issue #87.
  class SupabaseAuthGuard implements CanActivate {
    async canActivate(executionContext: ExecutionContext): Promise<boolean> {
      // Fail loudly on non-HTTP transports rather than silently allowing them
      // through — the guard cannot read WS/RPC payloads, so a misapplied guard
      // would otherwise be a no-op on every message.
      const contextType = executionContext.getType()
      if (contextType !== 'http') {
        throw new HttpException(
          {
            message: `withSupabase guard only supports HTTP contexts (got '${contextType}'). Authenticate non-HTTP transports separately.`,
            code: 'unsupported_context',
          },
          500,
        )
      }

      const req = executionContext.switchToHttp().getRequest<NestRequestLike>()

      const { data: ctx, error } = await createSupabaseContext(
        toWebRequest(req),
        config,
      )
      if (error) {
        throw new HttpException(
          { message: error.message, code: error.code },
          error.status,
          { cause: error },
        )
      }

      req.supabaseContext = ctx
      return true
    }
  }

  Injectable()(SupabaseAuthGuard)
  return SupabaseAuthGuard
}
