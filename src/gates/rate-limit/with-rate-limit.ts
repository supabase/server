/**
 * Fixed-window rate-limit gate.
 *
 * Counts hits per key within a rolling window via a Supabase Postgres RPC;
 * rejects with 429 when the count exceeds `limit`.
 *
 * The user owns the schema. Run the migration in this gate's README to
 * install the table + atomic-increment function. The gate then calls
 * `ctx.supabaseAdmin.rpc(<rpc-name>, { p_key, p_window_ms })` and expects
 * back `{ count, reset_at }` (ms epoch). The admin client comes from
 * `withSupabase` upstream — this gate must be wrapped by it (or any wrapper
 * that provides `supabaseAdmin`).
 */

import { defineGate } from '../../core/gates/index.js'

const DEFAULT_RPC = '_supabase_server_rate_limit_hit'

/**
 * Structural subset of the Supabase admin client surface used by this gate.
 * Any client whose `rpc` resolves to Supabase-shaped `{ data, error }`
 * works — typed as `PromiseLike` so `supabase-js`'s `PostgrestFilterBuilder`
 * (a thenable, not a strict `Promise`) satisfies it.
 */
export interface SupabaseRpcClient {
  rpc<T = unknown>(
    fn: string,
    args?: Record<string, unknown>,
  ): PromiseLike<{
    data: T | null
    error: { message: string; code?: string } | null
  }>
}

export interface WithRateLimitConfig {
  /** Maximum hits per `windowMs` per key. */
  limit: number

  /** Window length in milliseconds. */
  windowMs: number

  /**
   * Extracts the bucketing key from the request. Common choices:
   * - `req => req.headers.get('cf-connecting-ip') ?? 'anon'` for per-IP limits
   * - `(req) => req.headers.get('authorization') ?? 'anon'` for per-bearer limits
   */
  key: (req: Request) => string | Promise<string>

  /**
   * Name of the SQL function the user registered. The function must accept
   * `p_key text` and `p_window_ms bigint` and return
   * `{ count: int, reset_at: bigint }` (ms epoch).
   *
   * @defaultValue `'_supabase_server_rate_limit_hit'`
   */
  rpc?: string
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

interface RpcResult {
  count: number
  reset_at: number
}

/**
 * Fixed-window rate-limit gate. Must be wrapped by `withSupabase` (or any
 * wrapper that provides `supabaseAdmin`) — the gate calls into it.
 *
 * @example
 * ```ts
 * import { withSupabase } from '@supabase/server'
 * import { withRateLimit } from '@supabase/server/gates/rate-limit'
 *
 * export default {
 *   fetch: withSupabase(
 *     { allow: 'always' },
 *     withRateLimit(
 *       {
 *         limit: 60,
 *         windowMs: 60_000,
 *         key: (req) => req.headers.get('cf-connecting-ip') ?? 'anon',
 *       },
 *       async (req, ctx) =>
 *         Response.json({ remaining: ctx.rateLimit.remaining }),
 *     ),
 *   ),
 * }
 * ```
 */
export const withRateLimit = defineGate<
  'rateLimit',
  WithRateLimitConfig,
  { supabaseAdmin: SupabaseRpcClient },
  RateLimitState
>({
  key: 'rateLimit',
  run: (config) => {
    const rpc = config.rpc ?? DEFAULT_RPC

    return async (req, ctx) => {
      const key = await config.key(req)
      const { data, error } = await ctx.supabaseAdmin.rpc<RpcResult>(rpc, {
        p_key: key,
        p_window_ms: config.windowMs,
      })

      if (error || !data) {
        if (
          error?.code === '42883' ||
          error?.message?.toLowerCase().includes('function')
        ) {
          throw new Error(
            `withRateLimit: RPC '${rpc}' not found. Install the migration ` +
              `from this gate's README before calling.`,
          )
        }
        throw new Error(
          `withRateLimit: rpc failed: ${error?.message ?? 'no data returned'}`,
        )
      }

      const remaining = Math.max(0, config.limit - data.count)
      const resetSec = Math.floor(data.reset_at / 1000)

      if (data.count > config.limit) {
        const retryAfter = Math.max(
          1,
          Math.ceil((data.reset_at - Date.now()) / 1000),
        )
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
          reset: data.reset_at,
        },
      }
    }
  },
})
