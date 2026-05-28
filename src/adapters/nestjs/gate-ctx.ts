import {
  createParamDecorator,
  type ExecutionContext,
  type PipeTransform,
  type Type,
} from '@nestjs/common'

import type { Gate } from '../../core/gates/define-gate.js'

import type { NestRequestLike } from './_internal.js'

/**
 * Builds a typed param decorator that reads a gate's contribution from
 * `req.gateContext`. Pair with {@link asGuard} on the same controller / route.
 *
 * The gate's `Contribution` type flows through, so the returned decorator
 * yields the right type at the param site. Pass a sub-key to drill into the
 * contribution; pass pipes the same way you would on Nest's built-in
 * decorators (`@FeatureFlagCtx('enabled', BooleanPipe)`).
 *
 * @example
 * ```ts
 * import { gateCtx } from '@supabase/server/adapters/nestjs'
 * import { withFeatureFlag } from '@supabase/server/gates/feature-flag'
 *
 * export const FeatureFlagCtx = gateCtx(withFeatureFlag)
 *
 * @Controller('beta')
 * @UseGuards(
 *   withSupabase({ auth: 'user' }),
 *   asGuard(withFeatureFlag, { name: 'beta', evaluate: ... }),
 * )
 * export class BetaController {
 *   @Get()
 *   list(@FeatureFlagCtx() flag) {
 *     // flag: { name: string; enabled: true } | undefined
 *   }
 *
 *   @Get('enabled')
 *   isOn(@FeatureFlagCtx('enabled') enabled: boolean | undefined) {
 *     return { enabled }
 *   }
 * }
 * ```
 */
export function gateCtx<
  Key extends string,
  Config,
  In extends object,
  Contribution,
>(
  gate: Gate<Key, Config, In, Contribution>,
): {
  (...pipes: (Type<PipeTransform> | PipeTransform)[]): ParameterDecorator
  <Field extends keyof Contribution & string>(
    data: Field,
    ...pipes: (Type<PipeTransform> | PipeTransform)[]
  ): ParameterDecorator
} {
  // Capture the gate key once. The decorator factory below closes over it so
  // the runtime read needs no per-invocation lookup.
  const key = gate.key

  return createParamDecorator(
    (data: string | undefined, ctx: ExecutionContext) => {
      const req = ctx.switchToHttp().getRequest<NestRequestLike>()
      const contribution = req.gateContext?.[key] as Contribution | undefined
      if (data === undefined) return contribution
      return (contribution as Record<string, unknown> | undefined)?.[data]
    },
  ) as ReturnType<typeof gateCtx<Key, Config, In, Contribution>>
}
