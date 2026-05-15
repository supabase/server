/**
 * Feature-flag gate — the canonical example of a `defineGate` implementation.
 *
 * Provider-agnostic: pass any `evaluate` function (PostHog, LaunchDarkly,
 * Statsig, a header check, a database lookup). The gate calls it per request
 * and either admits with the verdict at `ctx.featureFlag` or short-circuits
 * with a configurable response.
 *
 * Read alongside `src/gates/README.md` and `src/core/gates/README.md` — this
 * file is referenced from both as the worked example of the pattern.
 */

import { defineGate, type Gate } from '../../core/gates/index.js'

/**
 * Per-instance configuration the consumer passes to `withFeatureFlag(config, handler)`.
 *
 * Keep this surface small — every field becomes part of the gate's public API.
 */
export interface WithFeatureFlagConfig {
  /** Human-readable name for the flag. Echoed back on `ctx.featureFlag.name` and the default rejection body. */
  name: string

  /**
   * Decide whether the flag is enabled for this request.
   *
   * Return `true`/`false` for a simple on-off check, or a {@link FeatureFlagVerdict}
   * to also record a variant or provider payload. Async is fine.
   */
  evaluate: (
    req: Request,
  ) => Promise<boolean | FeatureFlagVerdict> | boolean | FeatureFlagVerdict

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
 * Richer return shape `evaluate` may produce, in place of a plain boolean,
 * when an A/B variant or provider payload is worth carrying through to the
 * handler.
 */
export interface FeatureFlagVerdict {
  enabled: boolean
  /** A/B test variant if applicable. */
  variant?: string | null
  /** Provider-specific payload (rollout %, targeting rules, etc.). */
  payload?: unknown
}

/**
 * Shape contributed at `ctx.featureFlag` after a successful evaluation.
 *
 * `enabled: true` is encoded in the type — the handler only ever sees this
 * shape when the flag admitted, so `if (!ctx.featureFlag.enabled)` is a dead
 * branch by construction. The contribution shape is the contract this gate
 * offers downstream handlers.
 */
export interface FeatureFlagState {
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
 * import { withFeatureFlag } from '@supabase/server/gates/feature-flag'
 *
 * export default {
 *   fetch: withFeatureFlag(
 *     {
 *       name: 'beta-checkout',
 *       evaluate: (req) => req.headers.get('x-beta') === '1',
 *     },
 *     async (_req, ctx) => Response.json({ feature: ctx.featureFlag.name }),
 *   ),
 * }
 * ```
 *
 * Pluggable providers — use whatever you like in `evaluate`:
 *
 * ```ts
 * withFeatureFlag({
 *   name: 'beta-checkout',
 *   evaluate: async (req) => {
 *     const userId = req.headers.get('x-user-id') ?? 'anon'
 *     return await posthog.isFeatureEnabled('beta-checkout', userId)
 *   },
 * })
 * ```
 */
export const withFeatureFlag: Gate<
  // 1. Key — the slot this gate contributes to `ctx`. Must be unique in a stack.
  'featureFlag',
  // 2. Config — what the consumer passes to `withFeatureFlag(config, handler)`.
  WithFeatureFlagConfig,
  // 3. In — upstream prerequisites. `Record<never, never>` = no prerequisites,
  //    so this gate can be used standalone or anywhere in a stack.
  Record<never, never>,
  // 4. Contribution — the shape that lands at `ctx.featureFlag`.
  FeatureFlagState
> = defineGate<
  'featureFlag',
  WithFeatureFlagConfig,
  Record<never, never>,
  FeatureFlagState
>({
  key: 'featureFlag',
  /**
   * Two-stage function. The outer `(config) =>` runs once when the consumer
   * constructs the gate — initialize per-instance state here (clients,
   * computed config). The inner `(req, _ctx) =>` runs per request.
   *
   * Return a `Response` to short-circuit (the inner handler never runs), or a
   * single-key object `{ [key]: contribution }` to fall through. The runtime
   * picks `result[key]` off the contribution and ignores any other fields.
   */
  run: (config) => async (req) => {
    const result = await config.evaluate(req)
    const verdict: FeatureFlagVerdict =
      typeof result === 'boolean' ? { enabled: result } : result

    if (!verdict.enabled) {
      // Short-circuit: the inner handler is never invoked.
      return Response.json(
        config.rejectBody ?? { error: 'feature_disabled', flag: config.name },
        { status: config.rejectStatus ?? 404 },
      )
    }

    // Contribute: fall through to the inner handler with this shape on ctx.
    return {
      featureFlag: {
        name: config.name,
        enabled: true,
        variant: verdict.variant ?? null,
        payload: verdict.payload ?? null,
      },
    }
  },
})
