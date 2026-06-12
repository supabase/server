import {
  HttpException,
  Injectable,
  type CanActivate,
  type ExecutionContext,
  type Type,
} from '@nestjs/common'

import {
  defineAdapter,
  type AdapterWithSupabase,
} from '../../core/adapters/index.js'
import { createSupabaseContext } from '../../create-supabase-context.js'
import type { AuthError } from '../../errors.js'
import type { SupabaseContext } from '../../types.js'

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

function throwHttpException(error: AuthError): never {
  throw new HttpException(
    { message: error.message, code: error.code },
    error.status,
    { cause: error },
  )
}

/**
 * NestJS adapter for `@supabase/server`.
 *
 * Exports a single overloaded `withSupabase`:
 *
 * - **One arg** — `withSupabase(config)` returns a NestJS guard class that
 *   creates a {@link SupabaseContext}, stores it on the underlying request as
 *   `request.supabaseContext`, and throws `HttpException` (carrying the
 *   original `AuthError` as `.cause`) on auth failure.
 *
 *   The guard **always runs**, even if a previous guard already set the
 *   context — matching Nest's guard order (global → controller → handler) so
 *   handler-level guards can tighten what a global guard set.
 *
 *   **HTTP-only.** Throws on RPC/WebSocket contexts — those transports must
 *   authenticate via context-specific mechanisms.
 *
 * - **Two args** — `withSupabase(config, handler)` returns a dual-mode route
 *   handler that accepts either a plain `Request` (Web Fetch) or a NestJS
 *   `ExecutionContext`, extracts the underlying `Request`, and runs base
 *   `withSupabase` against it.
 *
 *   Auth failures throw `HttpException` for consistency with the one-arg
 *   form. CORS is excluded from the config — use NestJS's built-in CORS
 *   (`app.enableCors()`).
 *
 * @example One-arg — per-route auth via `@UseGuards(...)`
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
 * @example One-arg — app-wide auth via `app.useGlobalGuards()`
 * ```ts
 * import { NestFactory } from '@nestjs/core'
 * import { withSupabase } from '@supabase/server/adapters/nestjs'
 *
 * const app = await NestFactory.create(AppModule)
 * app.useGlobalGuards(new (withSupabase({ auth: 'user' }))())
 * await app.listen(3000)
 * ```
 */
export const withSupabase: AdapterWithSupabase<
  ExecutionContext,
  Type<CanActivate>
> = defineAdapter<ExecutionContext, Type<CanActivate>>({
  name: 'nestjs',
  extractRequest: (executionContext) => {
    if (executionContext.getType() !== 'http') return undefined
    return toWebRequest(
      executionContext.switchToHttp().getRequest<NestRequestLike>(),
    )
  },
  throwAuthError: throwHttpException,
  // No `getExistingContext` — Nest runs guards in global → controller → handler
  // order, so a handler-level guard must always re-evaluate (and override) what
  // an outer guard set. Skipping would let a permissive outer guard mask a
  // stricter inner one.
  middleware: (config) => {
    @Injectable()
    class SupabaseAuthGuard implements CanActivate {
      async canActivate(executionContext: ExecutionContext): Promise<boolean> {
        // Fail loudly on non-HTTP transports rather than silently allowing them
        // through — the guard cannot read WS/RPC payloads, so a misapplied
        // guard would otherwise be a no-op on every message.
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

        const req = executionContext
          .switchToHttp()
          .getRequest<NestRequestLike>()

        const { data: ctx, error } = await createSupabaseContext(
          toWebRequest(req),
          config,
        )
        if (error) throwHttpException(error)

        req.supabaseContext = ctx
        return true
      }
    }

    return SupabaseAuthGuard
  },
})
