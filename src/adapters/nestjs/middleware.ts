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
 * Skips if a previous guard or middleware already set the context, enabling
 * route-level overrides. Throws `HttpException` on auth failure — the original
 * `AuthError` is available via `cause`.
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
 */
export function withSupabase(
  config?: Omit<WithSupabaseConfig, 'cors'>,
): Type<CanActivate> {
  // Applied as a function call rather than `@Injectable()` syntax so the
  // bundled output contains no decorator tokens. Several JS runtimes (incl.
  // Node's CJS loader) refuse to parse decorator syntax at runtime, even
  // though the metadata semantics are identical.
  class SupabaseAuthGuard implements CanActivate {
    async canActivate(executionContext: ExecutionContext): Promise<boolean> {
      // HTTP-only: this guard reads HTTP headers via `switchToHttp()`. In RPC
      // or WebSocket contexts the request shape differs (no `headers`), so
      // skip rather than crash. Users on those transports should authenticate
      // via the appropriate context-specific mechanism.
      if (executionContext.getType() !== 'http') return true

      const req = executionContext.switchToHttp().getRequest<NestRequestLike>()

      // Skip if a previous guard already set the context. Enables stacking
      // `@UseGuards(withSupabase({ auth: 'user' }))` at the controller level
      // with a different auth mode at the handler level — the first one wins.
      if (req.supabaseContext) return true

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
