/**
 * Clock and randomness the backoff reads through, so a test can pin both.
 *
 * @internal
 */
export interface BackoffClock {
  now(): number
  /** In `[0, 1)`, like `Math.random`. */
  random(): number
}

/** @internal */
export interface BackoffPolicy {
  baseMs: number
  capMs: number
}

/**
 * A connection attempt that fails takes about one auth round trip, so an
 * unpaced pool of four retries roughly thirty times a second per process —
 * enough to trip the pooler's tenant-wide authentication circuit breaker
 * within seconds. Half a second to one second, doubling to between fifteen
 * and thirty, keeps a whole fleet of misconfigured isolates to a handful of
 * attempts a minute.
 *
 * @internal
 */
export const CONNECT_BACKOFF: BackoffPolicy = { baseMs: 1_000, capMs: 30_000 }

/** @internal */
export interface ConnectBackoff {
  /** Milliseconds left in the current pause; `0` when attempts may proceed. */
  remainingMs(): number
  /** The failure that opened the current pause, or the latest one during it. */
  lastError(): unknown
  /**
   * Record a failed connection attempt. Returns the pause opened, or `0` when
   * the failure landed inside a pause that is already running — parallel
   * failures from one round must not compound.
   */
  fail(error: unknown): number
  /** A new connection succeeded: clear the pause and start over from the base. */
  succeed(): void
}

/**
 * Exponential backoff with jitter for new connection attempts. The pause is
 * drawn from the upper half of the current delay, so a fleet of isolates that
 * failed together does not retry together.
 *
 * @internal
 */
export function createConnectBackoff(
  clock: BackoffClock,
  policy: BackoffPolicy = CONNECT_BACKOFF,
): ConnectBackoff {
  let rounds = 0
  let pausedUntil = 0
  let last: unknown

  return {
    remainingMs: () => Math.max(0, pausedUntil - clock.now()),
    lastError: () => last,
    fail(error) {
      last = error
      const now = clock.now()
      if (now < pausedUntil) return 0

      rounds += 1
      const full = Math.min(policy.capMs, policy.baseMs * 2 ** (rounds - 1))
      const pause = Math.round(full / 2 + clock.random() * (full / 2))
      pausedUntil = now + pause
      return pause
    },
    succeed() {
      rounds = 0
      pausedUntil = 0
      last = undefined
    },
  }
}
