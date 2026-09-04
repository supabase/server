const preAuthTag = Symbol.for('@supabase/server:preAuth')

/**
 * Marks every handler a middleware produces as belonging to a pre-auth
 * middleware, one that must run before any auth gate. `withSupabase` reads
 * the mark off its downstream handler at composition time and refuses a
 * stack that would run the middleware behind its gate.
 *
 * Both call forms are covered: the handler form marks the produced handler,
 * the entry form marks the handler the entry produces when a `pipeline`
 * folds it.
 */
export function tagPreAuth<T>(middleware: T, name: string): T {
  const base = middleware as unknown as (...args: unknown[]) => unknown
  const mark = <F>(fn: F): F => {
    Object.defineProperty(fn, preAuthTag, { value: name })
    return fn
  }
  const tagged = (...args: unknown[]) => {
    const out = base(...args)
    if (typeof args[args.length - 1] === 'function') return mark(out)
    return (handler: unknown) => mark((out as (h: unknown) => unknown)(handler))
  }
  return tagged as unknown as T
}

/** The pre-auth middleware name a handler carries, or `undefined`. */
export function preAuthName(handler: unknown): string | undefined {
  return typeof handler === 'function' && preAuthTag in handler
    ? (handler as unknown as Record<symbol, string>)[preAuthTag]
    : undefined
}
