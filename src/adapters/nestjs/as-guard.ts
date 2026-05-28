import {
  HttpException,
  Injectable,
  type CanActivate,
  type ExecutionContext,
  type Type,
} from '@nestjs/common'

import type { Gate } from '../../core/gates/define-gate.js'

import { toWebRequest, type NestRequestLike } from './_internal.js'

/**
 * Bridges a gate into NestJS's guard model.
 *
 * Gates compose as fetch-handler wrappers in the Web Fetch / Hono / H3 / Elysia
 * form. NestJS doesn't have that composition point — routes are decorated
 * methods, not nested handlers — so this helper drives a gate's check phase
 * inside a `CanActivate` guard:
 *
 * 1. Reads upstream ctx from `req.supabaseContext` + `req.gateContext`. The
 *    merge is what lets a gate's `In = { supabase, userClaims }` find its
 *    prereqs even though they live in a different bag than gate contributions.
 * 2. Calls `gate.run(config)(webReq, upstream)`.
 * 3. On a short-circuit `Response` (e.g. 404 for a disabled feature flag, 429
 *    for rate-limit), throws an `HttpException` so the response flows into
 *    Nest's exception-filter pipeline. The status is preserved; the body is
 *    parsed as JSON when possible, otherwise read as text.
 * 4. On a contribution, merges it into `req.gateContext` so subsequent guards
 *    and `@GateCtx()` reads see it.
 *
 * `req.supabaseContext` is never touched — gate contributions live in a
 * dedicated peer bag.
 *
 * HTTP-only. Throws on RPC / WebSocket contexts (the gate's `run` would have
 * no `Request` to operate on).
 *
 * @example
 * ```ts
 * @Controller('beta')
 * @UseGuards(
 *   withSupabase({ auth: 'user' }),
 *   asGuard(withFeatureFlag, {
 *     name: 'beta',
 *     evaluate: (req) => req.headers.has('x-beta'),
 *   }),
 * )
 * export class BetaController {
 *   @Get()
 *   list(@FeatureFlagCtx() flag) {
 *     return { flag }
 *   }
 * }
 * ```
 */
export function asGuard<
  Key extends string,
  Config,
  In extends object,
  Contribution,
>(
  gate: Gate<Key, Config, In, Contribution>,
  config: Config,
): Type<CanActivate> {
  @Injectable()
  class GateGuard implements CanActivate {
    async canActivate(executionContext: ExecutionContext): Promise<boolean> {
      const contextType = executionContext.getType()
      if (contextType !== 'http') {
        throw new HttpException(
          {
            message: `asGuard only supports HTTP contexts (got '${contextType}'). Gates operate on Web Requests; non-HTTP transports must be authenticated separately.`,
            code: 'unsupported_context',
          },
          500,
        )
      }

      const req = executionContext.switchToHttp().getRequest<NestRequestLike>()
      // Merge both bags so gates that declared `In = { supabase, userClaims }`
      // find their prereqs alongside gates that declared `In = { featureFlag }`.
      const upstream = {
        ...(req.supabaseContext ?? {}),
        ...(req.gateContext ?? {}),
      } as In

      const check = gate.run(config)
      const result = await check(toWebRequest(req), upstream)

      if (result instanceof Response) {
        throw await responseToHttpException(result)
      }

      // Defensive: defineGate already validates the run() return at runtime,
      // but asGuard is the second consumer of `run` now — guard against a
      // future bug where the contract is loosened.
      if (
        result === null ||
        typeof result !== 'object' ||
        !(gate.key in result)
      ) {
        throw new Error(
          `asGuard: gate '${gate.key}' run() returned an object missing the gate's key`,
        )
      }

      const contribution = (result as Record<string, unknown>)[gate.key]
      req.gateContext = { ...(req.gateContext ?? {}), [gate.key]: contribution }
      return true
    }
  }

  return GateGuard
}

/**
 * Convert a `Response` (returned by a gate's short-circuit) into an
 * `HttpException` so Nest's exception filters / `app.useGlobalFilters` get a
 * chance to handle it. JSON bodies are parsed (matching what gates emit via
 * `Response.json(...)`); non-JSON bodies fall back to text.
 */
async function responseToHttpException(
  response: Response,
): Promise<HttpException> {
  const contentType = response.headers.get('content-type') ?? ''
  const body = contentType.includes('application/json')
    ? await response.json().catch(() => response.statusText)
    : await response.text().catch(() => response.statusText)
  return new HttpException(body, response.status)
}
