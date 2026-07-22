// Loads every built entrypoint in a plain Node process — no transpiler in the
// chain — to catch output that fails to parse/load as a real consumer would
// (e.g. untranspiled decorator syntax; see issue #87). vitest can't catch this
// because it re-transpiles imported modules through swc/esbuild.
//
// Entrypoints are derived from package.json `exports` so this stays in sync as
// adapters are added. Run after `pnpm build`: `pnpm smoke`.

import { createRequire } from 'node:module'
import { dirname, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { readFileSync } from 'node:fs'

const require = createRequire(import.meta.url)
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')

const pkg = JSON.parse(readFileSync(resolve(root, 'package.json'), 'utf8'))

// Collect (subpath, format, absolute file) triples from every export condition
// that points at a built .mjs/.cjs file.
const targets = []
for (const [subpath, entry] of Object.entries(pkg.exports ?? {})) {
  if (typeof entry !== 'object') continue
  const mjs = entry.import?.default
  const cjs = entry.require?.default
  if (mjs) targets.push({ subpath, format: 'esm', file: resolve(root, mjs) })
  if (cjs) targets.push({ subpath, format: 'cjs', file: resolve(root, cjs) })
}

const failures = []
for (const { subpath, format, file } of targets) {
  try {
    if (format === 'esm') await import(pathToFileURL(file).href)
    else require(file)
    console.log(`ok   ${format.padEnd(3)} ${subpath}`)
  } catch (err) {
    console.error(`FAIL ${format.padEnd(3)} ${subpath}`)
    console.error(`     ${err?.stack ?? err}`)
    failures.push({ subpath, format, file })
  }
}

if (failures.length > 0) {
  console.error(
    `\n${failures.length} built entrypoint(s) failed to load in raw Node.`,
  )
  process.exit(1)
}

console.log(
  `\nAll ${targets.length} built entrypoints load cleanly in raw Node.`,
)
