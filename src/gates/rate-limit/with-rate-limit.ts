/**
 * Fixed-window rate-limit gate.
 *
 * Counts hits per key within a rolling window; rejects with 429 when the
 * count exceeds `limit`. The store is pluggable — defaults to a per-process
 * in-memory `Map`. For multi-instance / serverless deployments, supply a
 * Postgres-, Redis-, or KV-backed implementation.
 */

import { defineGate } from '../../core/gates/index.js'

export interface RateLimitStore {
  /**
   * Atomically increment the hit count for `key` within a window of length
   * `windowMs` milliseconds. Returns the post-increment count and the
   * absolute timestamp (ms epoch) when the current window resets.
   */
  hit(
    key: string,
    windowMs: number,
  ): Promise<{ count: number; resetAt: number }>
}

export interface WithRateLimitConfig {
  /** Maximum hits per `windowMs` per key. */
  limit: number

  /** Window length in milliseconds. */
  windowMs: number

  /**
   * Extracts the bucketing key from the request. Common choices:
   * - `req => req.headers.get('cf-connecting-ip') ?? 'anon'` for per-IP limits
   * - `(_, ctx) => ctx.userClaims?.id ?? 'anon'` for per-user limits (when
   *   composed inside `withSupabase`)
   */
  key: (req: Request) => string | Promise<string>

  /**
   * Backing store. Defaults to an in-memory `Map` suitable for tests and
   * single-process dev. Production multi-instance deployments need a shared
   * store so windows aren't reset by request affinity.
   */
  store?: RateLimitStore
}

/** Shape contributed at `ctx.rateLimit` after a successful hit. */
export interface RateLimitState {
  /** The configured limit for this window. */
  limit: number
  /** Hits remaining in the current window. */
  remaining: number
  /** Absolute ms timestamp when the current window resets. */
  reset: number
}

/**
 * Fixed-window rate-limit gate.
 *
 * @example
 * ```ts
 * import { chain } from '@supabase/server/core/gates'
 * import { withRateLimit } from '@supabase/server/gates/rate-limit'
 *
 * export default {
 *   fetch: chain(
 *     withRateLimit({
 *       limit: 60,
 *       windowMs: 60_000,
 *       key: (req) => req.headers.get('cf-connecting-ip') ?? 'anon',
 *     }),
 *   )(async (req, ctx) => {
 *     return Response.json({ remaining: ctx.rateLimit.remaining })
 *   }),
 * }
 * ```
 */
export const withRateLimit = defineGate<
  'rateLimit',
  WithRateLimitConfig,
  Record<never, never>,
  RateLimitState
>({
  key: 'rateLimit',
  run: (config) => {
    const store = config.store ?? createMemoryStore()

    return async (req) => {
      const key = await config.key(req)
      const { count, resetAt } = await store.hit(key, config.windowMs)
      const remaining = Math.max(0, config.limit - count)
      const resetSec = Math.floor(resetAt / 1000)

      if (count > config.limit) {
        const retryAfter = Math.max(1, Math.ceil((resetAt - Date.now()) / 1000))
        return {
          kind: 'reject',
          response: Response.json(
            { error: 'rate_limit_exceeded', retryAfter },
            {
              status: 429,
              headers: {
                'Retry-After': String(retryAfter),
                'X-RateLimit-Limit': String(config.limit),
                'X-RateLimit-Remaining': '0',
                'X-RateLimit-Reset': String(resetSec),
              },
            },
          ),
        }
      }

      return {
        kind: 'pass',
        contribution: {
          limit: config.limit,
          remaining,
          reset: resetAt,
        },
      }
    }
  },
})

/** Default in-memory store. Single-process only. */
export function createMemoryStore(): RateLimitStore {
  const buckets = new Map<string, { count: number; resetAt: number }>()
  return {
    async hit(key, windowMs) {
      const now = Date.now()
      const existing = buckets.get(key)
      if (!existing || existing.resetAt <= now) {
        const fresh = { count: 1, resetAt: now + windowMs }
        buckets.set(key, fresh)
        return { ...fresh }
      }
      existing.count += 1
      return { count: existing.count, resetAt: existing.resetAt }
    },
  }
}
