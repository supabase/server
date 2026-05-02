import type { Gate, GateResult, ValidNamespace } from './types.js'

/**
 * Defines a gate. Returns a config-taking factory function that produces a
 * {@link Gate} value, suitable for use with {@link chain}.
 *
 * A gate is a small unit that runs against an inbound `Request` and the
 * upstream context. It either short-circuits with a `Response` (rejection) or
 * contributes a typed value at `ctx.state[namespace]` (pass).
 *
 * @typeParam Namespace - Literal string used as the slot under `ctx.state`.
 * Cannot be a reserved name (see {@link ReservedNamespace}).
 * @typeParam Config - The configuration object the factory accepts.
 * @typeParam In - Structural shape the gate requires from the upstream ctx.
 * Defaults to `{}` (no prerequisites).
 * @typeParam Contribution - Shape of the value placed at `ctx.state[Namespace]`.
 *
 * @example
 * ```ts
 * import { defineGate } from '@supabase/server/core/gates'
 *
 * export const withFlag = defineGate({
 *   namespace: 'flag',
 *   run: (config: { name: string }) => async (req) => {
 *     const enabled = req.headers.get(`x-flag-${config.name}`) === '1'
 *     return { kind: 'pass', contribution: { name: config.name, enabled } }
 *   },
 * })
 *
 * // Consumer:
 * chain(withFlag({ name: 'beta' }))(async (req, ctx) => {
 *   if (!ctx.state.flag.enabled) return new Response('not enabled', { status: 404 })
 *   return Response.json({ ok: true })
 * })
 * ```
 */
export function defineGate<
  const Namespace extends string,
  Config,
  In extends object = Record<never, never>,
  Contribution = unknown,
>(spec: {
  namespace: ValidNamespace<Namespace>
  run: (
    config: Config,
  ) => (req: Request, ctx: In) => Promise<GateResult<Contribution>>
}): (config: Config) => Gate<In, Namespace, Contribution> {
  return (config) => ({
    namespace: spec.namespace as Namespace,
    run: spec.run(config),
  })
}
