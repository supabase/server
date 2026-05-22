import { describe, expect, expectTypeOf, it, vi } from 'vitest'

import type { SupabaseContext, WithSupabaseConfig } from '../types.js'

import { withSupabase as base } from '../with-supabase.js'
import { withSupabase as elysia } from './elysia/plugin.js'
import { withSupabase as h3 } from './h3/middleware.js'
import { withSupabase as hono } from './hono/middleware.js'

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
 * forwarding the consumer's `config` and `handler` to base, forwarding
 * a valid `Request` to base's returned handler, and returning base's
 * `Response` unchanged.
 *
 * Adapters are allowed to interpose input validation before forwarding
 * (e.g. detecting that the caller passed a framework context instead
 * of a Request and throwing a framework-specific TypeError). The
 * "happy path" behavior — a valid Request goes through unchanged —
 * stays pinned.
 *
 * Two checks:
 *
 * 1. **Runtime delegation** — `vi.mock` replaces the base; every
 *    adapter discovered under `src/adapters/*` must call the mock with
 *    the consumer's args, then forward a real Request to the mock's
 *    returned handler, then return that handler's Response.
 * 2. **Type-level identity** — `expectTypeOf` asserts each adapter's
 *    two-arg form has the same handler-parameter type and return type
 *    as base. Catches signature drift at typecheck.
 *
 * The type-level check enumerates known adapters statically (TS can't
 * `import.meta.glob` types). New adapters added to `src/adapters/` are
 * picked up by the runtime check automatically; the type-level enum
 * needs a one-line addition.
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

describe('every adapter has the same two-arg signature as base (type-level)', () => {
  // Compile-time only — these expectations don't run anything; they fail
  // at `tsc` if the adapter's two-arg overload's handler/return type drifts
  // from base.
  it('handler parameter and return type match base', () => {
    type BaseHandlerArg = Parameters<typeof base>[1]
    type BaseReturn = ReturnType<typeof base>

    expectTypeOf<Parameters<typeof hono>[1]>().toEqualTypeOf<BaseHandlerArg>()
    expectTypeOf<ReturnType<typeof hono>>().toEqualTypeOf<BaseReturn>()

    expectTypeOf<Parameters<typeof h3>[1]>().toEqualTypeOf<BaseHandlerArg>()
    expectTypeOf<ReturnType<typeof h3>>().toEqualTypeOf<BaseReturn>()

    expectTypeOf<Parameters<typeof elysia>[1]>().toEqualTypeOf<BaseHandlerArg>()
    expectTypeOf<ReturnType<typeof elysia>>().toEqualTypeOf<BaseReturn>()
  })
})
