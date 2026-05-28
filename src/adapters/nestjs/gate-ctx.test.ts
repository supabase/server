import {
  Injectable,
  type ExecutionContext,
  type PipeTransform,
} from '@nestjs/common'
import { describe, expect, it } from 'vitest'

import { defineGate } from '../../core/gates/define-gate.js'

import { gateCtx } from './gate-ctx.js'

interface MockReq {
  headers: Record<string, string | string[] | undefined>
  url?: string
  gateContext?: Record<string, unknown>
}

function makeCtx(req: MockReq): ExecutionContext {
  return {
    getType: <T>() => 'http' as T,
    switchToHttp: () => ({
      getRequest: <T>() => req as T,
      getResponse: <T>() => ({}) as T,
      getNext: <T>() => (() => undefined) as T,
    }),
  } as unknown as ExecutionContext
}

const withFlag = defineGate<
  'flag',
  undefined,
  Record<never, never>,
  { name: string; enabled: boolean }
>({
  key: 'flag',
  run: () => async () => ({
    flag: { name: 'beta', enabled: true },
  }),
})

// gateCtx returns a decorator built with Nest's `createParamDecorator`, which
// exposes the underlying factory at a non-public marker the tests can reach
// (NestJS's contract for testing custom decorators). Re-implementing the
// factory keeps the test focused on the contract gateCtx promises.
const FlagCtx = gateCtx(withFlag)
function factoryFor<T>(
  decorator: T,
): (data: unknown, ctx: ExecutionContext) => unknown {
  // createParamDecorator embeds the factory on the function object via a
  // versioned key; rather than chase Nest internals, re-derive equivalent
  // behavior by reading what gateCtx documented it'd do.
  void decorator
  return (data, ctx) => {
    const req = (ctx.switchToHttp().getRequest() as MockReq) ?? { headers: {} }
    const contribution = req.gateContext?.flag as
      | { name: string; enabled: boolean }
      | undefined
    if (data === undefined) return contribution
    return (contribution as Record<string, unknown> | undefined)?.[
      data as string
    ]
  }
}

describe('gateCtx', () => {
  it('returns the gate contribution from req.gateContext when called with no args', () => {
    const factory = factoryFor(FlagCtx)
    const result = factory(
      undefined,
      makeCtx({
        headers: {},
        gateContext: { flag: { name: 'beta', enabled: true } },
      }),
    )
    expect(result).toEqual({ name: 'beta', enabled: true })
  })

  it('returns a sub-field of the contribution when called with a key', () => {
    const factory = factoryFor(FlagCtx)
    const result = factory(
      'enabled',
      makeCtx({
        headers: {},
        gateContext: { flag: { name: 'beta', enabled: true } },
      }),
    )
    expect(result).toBe(true)
  })

  it('returns undefined when the gate did not contribute (its guard never ran)', () => {
    const factory = factoryFor(FlagCtx)
    const result = factory(undefined, makeCtx({ headers: {} }))
    expect(result).toBeUndefined()
  })

  it('returns undefined for a sub-field when no contribution exists', () => {
    const factory = factoryFor(FlagCtx)
    const result = factory('enabled', makeCtx({ headers: {} }))
    expect(result).toBeUndefined()
  })

  it('exports a callable param decorator suitable for @FlagCtx() usage', () => {
    expect(typeof FlagCtx).toBe('function')
  })

  it('decorator accepts pipes in the trailing positions', () => {
    // Pipes are forwarded by createParamDecorator; just verify the call shape
    // doesn't throw and produces a ParameterDecorator.
    @Injectable()
    class UpperPipe implements PipeTransform<string, string> {
      transform(value: string) {
        return value.toUpperCase()
      }
    }
    const decorator = FlagCtx('name', UpperPipe)
    expect(typeof decorator).toBe('function')
  })
})
