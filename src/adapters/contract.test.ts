import { describe, expect, it, vi } from 'vitest'

import type { SupabaseContext, WithSupabaseConfig } from '../types.js'

// Vite/vitest provides `import.meta.glob` for build-time module discovery.
// We declare the slot here rather than reach for `/// <reference types="vite/client" />`
// (vite isn't a direct dependency) or pull in `@types/node` for tsconfig.
declare global {
  interface ImportMeta {
    glob<T>(pattern: string): Record<string, () => Promise<T>>
  }
}

/**
 * Contract test: every adapter's two-arg `withSupabase` form must
 * delegate to the base `withSupabase` from `@supabase/server` —
 * forwarding the consumer's `config` and `handler` to base, and
 * forwarding a `Request` (either passed directly or extracted from
 * the framework's native context) to base's returned handler and
 * returning its `Response` unchanged.
 *
 * Adapters wrap base's returned handler in a framework-shaped function
 * that runtime-extracts the underlying Request from the framework's
 * native input. This test exercises the Request-passed-directly path —
 * the simplest invariant that pins delegation without setting up each
 * framework's call shape.
 *
 * `vi.mock` replaces the base. Every adapter discovered under
 * `src/adapters/*` must (a) call the mock with the consumer's
 * `config`/`handler`, then (b) when its returned function is invoked
 * with a real `Request`, forward that `Request` to base's returned
 * handler and return that handler's `Response`.
 *
 * New adapters added to `src/adapters/` are picked up automatically
 * via `import.meta.glob`.
 *
 * Return-type checks are intentionally not asserted here: each
 * adapter's two-arg form returns a framework-shaped function
 * (Hono `Handler`-compatible, H3 `EventHandler`-compatible, etc.), so
 * a single cross-adapter return type would be incorrect. Each adapter
 * test file exercises framework-mounted behavior end-to-end.
 */

const baseMock = vi.hoisted(() => ({ withSupabase: vi.fn() }))
vi.mock('../with-supabase.js', () => baseMock)

interface AdapterModule {
  withSupabase: (
    config: WithSupabaseConfig,
    handler: (req: Request, ctx: SupabaseContext) => Promise<Response>,
  ) => (req: Request) => Promise<Response>
}

const adapters = import.meta.glob<AdapterModule>('./*/index.ts')
const adapterEntries = Object.entries(adapters)

describe('every adapter delegates its two-arg form to base withSupabase', () => {
  it.each(adapterEntries)(
    "%s — forwards config/handler to base and a valid Request through base's returned handler",
    async (_path, loader) => {
      // Distinct sentinel per case so a cross-adapter leak would surface.
      const SENTINEL_RESPONSE = new Response('sentinel')
      const baseInner = vi.fn(async () => SENTINEL_RESPONSE)
      baseMock.withSupabase.mockReturnValueOnce(baseInner)

      const mod = await loader()
      const config: WithSupabaseConfig = { auth: 'user' }
      const handler = async () => Response.json({})

      const adapterHandler = mod.withSupabase(config, handler)
      expect(baseMock.withSupabase).toHaveBeenLastCalledWith(config, handler)

      const req = new Request('https://example.test/')
      const result = await adapterHandler(req)

      expect(baseInner).toHaveBeenCalledWith(req)
      expect(result).toBe(SENTINEL_RESPONSE)
    },
  )

  it('jsr.json, package.json, and the source tree declare the same adapter set', async () => {
    const [jsrConfig, pkgConfig] = await Promise.all([
      import('../../jsr.json', { with: { type: 'json' } }).then(
        (m) => m.default,
      ),
      import('../../package.json', { with: { type: 'json' } }).then(
        (m) => m.default,
      ),
    ])

    const fromGlob = adapterEntries
      .map(([path]) => path.replace(/^\.\/(.+)\/index\.ts$/, './adapters/$1'))
      .sort()
    const fromJsr = Object.keys(jsrConfig.exports)
      .filter((k) => k.startsWith('./adapters/'))
      .sort()
    const fromPkg = Object.keys(pkgConfig.exports)
      .filter((k) => k.startsWith('./adapters/'))
      .sort()

    expect(fromJsr).toEqual(fromGlob)
    expect(fromPkg).toEqual(fromGlob)
  })
})
