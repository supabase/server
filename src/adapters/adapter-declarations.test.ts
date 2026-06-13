import { describe, expect, it } from 'vitest'

// Vite/vitest provides `import.meta.glob` for build-time module discovery.
// We declare the slot here rather than reach for `/// <reference types="vite/client" />`
// (vite isn't a direct dependency) or pull in `@types/node` for tsconfig.
declare global {
  interface ImportMeta {
    glob<T>(pattern: string): Record<string, () => Promise<T>>
  }
}

/**
 * Tooling consistency check: every adapter discovered in `src/adapters/*`
 * must also be declared in both `jsr.json` and `package.json` exports.
 *
 * Adding an adapter to the source tree without wiring up its export
 * entries (or vice versa) silently produces an installable but
 * un-importable adapter. This test catches that at CI time.
 *
 * Runtime delegation of the two-arg form is enforced by
 * {@link file://./../core/define-adapter.test.ts}, and per-adapter
 * end-to-end behavior is pinned by each adapter's own `*.test.ts`. This
 * file only checks declarations.
 */

interface AdapterModule {
  withSupabase: unknown
}

const adapters = import.meta.glob<AdapterModule>('./*/index.ts')
const adapterEntries = Object.entries(adapters)

describe('adapter declarations', () => {
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
