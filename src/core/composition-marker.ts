/**
 * Marks a context assembled by `withSupabase` for the entries of its
 * `middleware` array. A middleware that behaves differently inside that
 * composition (a placement warning, for example) tests for this key instead
 * of duck-typing on context key names, which an unrelated upstream
 * middleware could collide with. Symbol keys survive the engine's context
 * spreads.
 *
 * @internal
 */
export const withSupabaseCtxMarker = Symbol('withSupabase.middlewareArray')
