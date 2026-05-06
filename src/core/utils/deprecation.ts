import type { AuthModeWithKey } from '../../types.js'

let allowDeprecationWarned = false

/**
 * Emits a one-time deprecation warning when the legacy `allow` option is used
 * instead of `auth`. The warning fires at most once per process to avoid
 * spamming logs in long-running servers.
 *
 * @internal
 */
export function warnAllowDeprecated(): void {
  if (allowDeprecationWarned) return
  allowDeprecationWarned = true
  console.warn(
    '[@supabase/server] The `allow` option is deprecated and will be removed in a future major release. Use `auth` instead — e.g. `{ auth: "user" }` instead of `{ allow: "user" }`.',
  )
}

/**
 * Resolves the auth mode from `auth` (preferred) or `allow` (deprecated),
 * falling back to `"user"` when neither is provided. Emits a one-time
 * deprecation warning when `allow` is used without `auth`.
 *
 * @internal
 */
export function resolveAuthOption(options: {
  auth?: AuthModeWithKey | AuthModeWithKey[]
  allow?: AuthModeWithKey | AuthModeWithKey[]
}): AuthModeWithKey | AuthModeWithKey[] {
  if (options.auth !== undefined) return options.auth
  if (options.allow !== undefined) {
    warnAllowDeprecated()
    return options.allow
  }
  return 'user'
}

/**
 * Test-only helper to reset the one-shot deprecation warning latch so each
 * test can independently observe the warning.
 *
 * @internal
 */
export function _resetAllowDeprecationWarned(): void {
  allowDeprecationWarned = false
}
