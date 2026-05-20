import type { RequestHandler } from 'express'

import { AuthError, InvalidCredentialsError } from '../../errors.js'
import type { AuthMode, AuthModeWithKey, SupabaseContext } from '../../types.js'

interface ParsedMode {
  base: AuthMode
  keyName: string | null
}

function parseMode(mode: AuthModeWithKey): ParsedMode {
  if (
    mode === 'none' ||
    mode === 'publishable' ||
    mode === 'secret' ||
    mode === 'user'
  ) {
    return { base: mode, keyName: null }
  }
  const colonIndex = mode.indexOf(':')
  const base = mode.slice(0, colonIndex) as AuthMode
  const keyName = mode.slice(colonIndex + 1)
  return { base, keyName: keyName || null }
}

function matchesMode(ctx: SupabaseContext, allowed: AuthModeWithKey): boolean {
  const { base, keyName } = parseMode(allowed)
  if (ctx.authMode !== base) return false
  if (keyName === null || keyName === '*') return true
  return ctx.authKeyName === keyName
}

/**
 * Per-route guard that ensures the request has been authenticated by an
 * upstream {@link withSupabase} middleware.
 *
 * Forwards an {@link AuthError} via `next(err)` when:
 * - `res.locals.supabaseContext` is absent (mount `withSupabase()` first), or
 * - `modes` is provided and the established `authMode` (and `authKeyName`, for
 *   the `publishable:<name>` / `secret:<name>` forms) does not match any of
 *   the allowed entries.
 *
 * The `publishable:*` and `secret:*` wildcards accept any named key for that
 * base mode. A bare `'publishable'` or `'secret'` accepts any key as well — the
 * named-key constraint was already enforced upstream by `withSupabase()`.
 *
 * @param modes - Optional allowed auth mode(s). When omitted, any established
 *   context passes through.
 *
 * @example
 * ```ts
 * app.use(withSupabase({ auth: ['user', 'secret'] }))
 * app.get('/me', requireAuth('user'), (_req, res) => {
 *   const { userClaims } = res.locals.supabaseContext
 *   res.json(userClaims)
 * })
 * ```
 */
export function requireAuth(
  modes?: AuthModeWithKey | AuthModeWithKey[],
): RequestHandler {
  const allowed =
    modes === undefined ? null : Array.isArray(modes) ? modes : [modes]

  return (_req, res, next) => {
    const ctx = res.locals.supabaseContext
    if (!ctx) {
      next(
        new AuthError(
          'Supabase context is missing — mount withSupabase() before requireAuth().',
          InvalidCredentialsError,
          401,
        ),
      )
      return
    }
    if (allowed === null) {
      next()
      return
    }
    if (allowed.some((mode) => matchesMode(ctx, mode))) {
      next()
      return
    }
    next(
      new AuthError(
        `Auth mode "${ctx.authMode}" is not allowed for this route.`,
        InvalidCredentialsError,
        401,
      ),
    )
  }
}
