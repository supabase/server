import type { UpstreamAuth } from '../types.js'

/**
 * Read the auth identity an upstream middleware seeded onto the context.
 *
 * The sole place the context is narrowed to `UpstreamAuth`. The cast is
 * unavoidable: the client entries declare no prerequisite, so the engine types
 * their `ctx` as the empty upstream.
 *
 * Returns an empty object when no upstream has run — the standalone case,
 * where the entries fall back to their default keys.
 */
export function readUpstreamAuth(ctx: unknown): UpstreamAuth {
  return (ctx ?? {}) as UpstreamAuth
}
