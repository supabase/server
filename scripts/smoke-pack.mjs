// Loads every entrypoint of the packed tarball from a throwaway consumer
// project that has no optional peers installed.
//
// `pnpm smoke` loads dist/ from inside this repo, where pnpm has auto-installed
// every optional peer, so an entrypoint that hard-requires one still loads. A
// real consumer installs only what they asked for. Anything outside the
// allowances below is a hard dependency the package does not declare, and it
// breaks that consumer on import.
//
// Run after `pnpm build`: `pnpm smoke:pack`.

import { execFileSync } from 'node:child_process'
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'))

// The optional peers each entrypoint is allowed to require. An entrypoint
// absent from this map must load with nothing installed beyond the package's
// own dependencies and its required peers.
const ALLOWED_OPTIONAL_PEERS = {
  './adapters/hono': ['hono'],
  './adapters/h3': ['h3'],
  './adapters/elysia': ['elysia'],
  './adapters/nestjs': ['@nestjs/common'],
  './middleware/postgres': ['pg'],
  './middleware/postgres-admin': ['pg'],
}

// A missing subpath export reports as `hono/factory`; the allowance is `hono`.
const packageName = (specifier) =>
  specifier.startsWith('@')
    ? specifier.split('/').slice(0, 2).join('/')
    : specifier.split('/')[0]

const optionalPeers = Object.entries(pkg.peerDependenciesMeta ?? {})
  .filter(([, meta]) => meta?.optional)
  .map(([name]) => name)

const subpaths = Object.entries(pkg.exports ?? {})
  .filter(([, entry]) => typeof entry === 'object' && entry.import?.default)
  .map(([subpath]) => subpath)

if (subpaths.length === 0) {
  console.error('No entrypoints found in package.json exports.')
  process.exit(1)
}

for (const subpath of Object.keys(ALLOWED_OPTIONAL_PEERS)) {
  if (!subpaths.includes(subpath)) {
    console.error(`Stale allowance: ${subpath} is not an entrypoint.`)
    process.exit(1)
  }
}

if (!existsSync(join(root, 'dist'))) {
  console.error('No dist/ found. Run `pnpm build` first.')
  process.exit(1)
}

const run = (cmd, args, cwd) =>
  execFileSync(cmd, args, {
    cwd,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  })

const workspace = mkdtempSync(join(tmpdir(), 'supabase-server-smoke-'))
let failed = false

try {
  // Packed into an empty directory and found by extension: npm's `prepare` hook
  // writes to stdout, so --json output cannot be parsed reliably.
  const packDir = join(workspace, 'pack')
  mkdirSync(packDir)
  run('npm', ['pack', '--pack-destination', packDir], root)
  const tarballName = readdirSync(packDir).find((file) => file.endsWith('.tgz'))
  if (!tarballName) {
    console.error('npm pack produced no tarball.')
    process.exit(1)
  }
  const tarball = join(packDir, tarballName)

  const consumer = join(workspace, 'consumer')
  mkdirSync(consumer)
  writeFileSync(
    join(consumer, 'package.json'),
    JSON.stringify({ name: 'smoke-consumer', version: '0.0.0', private: true }),
  )

  // npm installs required peers and skips optional ones, which is exactly the
  // consumer this test is about.
  run('npm', ['install', tarball, '--no-audit', '--no-fund'], consumer)

  const leaked = optionalPeers.filter((name) =>
    existsSync(join(consumer, 'node_modules', name)),
  )
  if (leaked.length > 0) {
    console.error(
      `Optional peers were installed (${leaked.join(', ')}), so this test proves nothing.`,
    )
    process.exit(1)
  }

  const loader = `
import { createRequire } from 'node:module'
const require = createRequire(import.meta.url)
const results = []
for (const subpath of ${JSON.stringify(subpaths)}) {
  const specifier = '${pkg.name}' + subpath.slice(1)
  for (const format of ['esm', 'cjs']) {
    try {
      if (format === 'esm') await import(specifier)
      else require(specifier)
      results.push({ subpath, format, ok: true })
    } catch (error) {
      results.push({ subpath, format, ok: false, message: error?.message ?? String(error) })
    }
  }
}
console.log(JSON.stringify(results))
`
  writeFileSync(join(consumer, 'load.mjs'), loader)
  const results = JSON.parse(run('node', ['load.mjs'], consumer))

  for (const { subpath, format, ok, message } of results) {
    const label = `${format.padEnd(3)} ${subpath}`
    if (ok) {
      console.log(`ok   ${label}`)
      continue
    }

    const missing = /Cannot find (?:module|package) '([^']+)'/.exec(
      message,
    )?.[1]
    const allowed = ALLOWED_OPTIONAL_PEERS[subpath] ?? []
    if (missing && allowed.includes(packageName(missing))) {
      console.log(
        `ok   ${label}  (needs optional peer ${packageName(missing)})`,
      )
      continue
    }

    failed = true
    console.error(`FAIL ${label}`)
    console.error(`     ${message}`)
    if (missing) {
      console.error(
        `     ${subpath} must not require ${missing} to load. Either it is a hard dependency that belongs in \`dependencies\`, or the build is pulling it into a shared chunk.`,
      )
    }
  }
} finally {
  rmSync(workspace, { recursive: true, force: true })
}

if (failed) {
  console.error('\nPacked entrypoints failed to load without optional peers.')
  process.exit(1)
}

console.log(
  `\nAll ${subpaths.length} packed entrypoints load in a consumer with no optional peers.`,
)
