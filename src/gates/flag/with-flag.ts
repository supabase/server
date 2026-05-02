/**
 * Feature-flag gate.
 *
 * Evaluates a flag for the inbound request and either admits with the
 * verdict at `ctx.state.flag` or short-circuits with a configurable response.
 * Provider-agnostic — pass any `evaluate` function (PostHog, LaunchDarkly,
 * Statsig, a header check, a database lookup).
 */

import { defineGate } from '../../core/gates/index.js'

export interface WithFlagConfig {
  /** Human-readable name for the flag, recorded in `ctx.state.flag.name`. */
  name: string

  /**
   * Evaluate the flag for the inbound request. Return `true` to admit,
   * `false` to reject with a default 404. Return an object to record
   * additional metadata (variant, payload) and admit; return
   * `{ enabled: false, ... }` to reject with custom data.
   */
  evaluate: (
    req: Request,
  ) => Promise<boolean | FlagVerdict> | boolean | FlagVerdict

  /**
   * HTTP status to use when the flag rejects. Default is 404 — "this feature
   * doesn't exist for you yet" — which is a softer reveal than 403 and avoids
   * tipping off attackers about the existence of gated functionality.
   *
   * @defaultValue `404`
   */
  rejectStatus?: number

  /** Body to use when the flag rejects. @defaultValue `{ error: 'feature_disabled', flag: <name> }` */
  rejectBody?: unknown
}

/**
 * Verdict shape that an `evaluate` function may return for richer state.
 */
export interface FlagVerdict {
  enabled: boolean
  /** A/B test variant if applicable. */
  variant?: string | null
  /** Provider-specific payload (rollout %, targeting rules, etc.). */
  payload?: unknown
}

/** Shape contributed at `ctx.state.flag` after a successful evaluation. */
export interface FlagState {
  name: string
  enabled: true
  variant: string | null
  payload: unknown
}

/**
 * Feature-flag gate.
 *
 * @example
 * ```ts
 * import { chain } from '@supabase/server/core/gates'
 * import { withFlag } from '@supabase/server/gates/flag'
 *
 * export default {
 *   fetch: chain(
 *     withFlag({
 *       name: 'beta-checkout',
 *       evaluate: (req) => req.headers.get('x-beta') === '1',
 *     }),
 *   )(async (_req, ctx) => {
 *     return Response.json({ feature: ctx.state.flag.name })
 *   }),
 * }
 * ```
 *
 * Pluggable providers — use whatever you like in `evaluate`:
 *
 * ```ts
 * withFlag({
 *   name: 'beta-checkout',
 *   evaluate: async (req) => {
 *     const userId = req.headers.get('x-user-id') ?? 'anon'
 *     return await posthog.isFeatureEnabled('beta-checkout', userId)
 *   },
 * })
 * ```
 */
export const withFlag = defineGate<
  'flag',
  WithFlagConfig,
  Record<never, never>,
  FlagState
>({
  namespace: 'flag',
  run: (config) => async (req) => {
    const result = await config.evaluate(req)
    const verdict: FlagVerdict =
      typeof result === 'boolean' ? { enabled: result } : result

    if (!verdict.enabled) {
      return {
        kind: 'reject',
        response: Response.json(
          config.rejectBody ?? { error: 'feature_disabled', flag: config.name },
          { status: config.rejectStatus ?? 404 },
        ),
      }
    }

    return {
      kind: 'pass',
      contribution: {
        name: config.name,
        enabled: true,
        variant: verdict.variant ?? null,
        payload: verdict.payload ?? null,
      },
    }
  },
})
