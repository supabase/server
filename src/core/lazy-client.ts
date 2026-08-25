/**
 * Wraps a client factory in a Proxy that defers construction to the first
 * interaction with the client — a property read or write, an `in` check,
 * `instanceof`, or key enumeration. Construction happens at most once: every
 * trap delegates to the same memoized instance. A factory throw surfaces at
 * the interaction that triggered it, and the factory runs again on the next
 * interaction.
 *
 * Function-valued properties are bound to the real instance, so class
 * internals (private fields, prototype getters) always see the instance
 * itself rather than the proxy.
 *
 * Inspecting an unconstructed proxy (`console.log`, test diff printers)
 * enumerates its keys and therefore triggers construction — in a
 * misconfigured environment, that inspection throws.
 */
export function lazyClient<T extends object>(build: () => T): T {
  let client: T | undefined
  const instance = () => (client ??= build())
  return new Proxy({} as T, {
    get(_target, prop) {
      const c = instance()
      const value = Reflect.get(c, prop) as unknown
      return typeof value === 'function'
        ? (value as (...args: never[]) => unknown).bind(c)
        : value
    },
    set: (_target, prop, value) => Reflect.set(instance(), prop, value),
    has: (_target, prop) => Reflect.has(instance(), prop),
    getPrototypeOf: () => Reflect.getPrototypeOf(instance()),
    ownKeys: () => Reflect.ownKeys(instance()),
    getOwnPropertyDescriptor: (_target, prop) =>
      Reflect.getOwnPropertyDescriptor(instance(), prop),
  })
}
