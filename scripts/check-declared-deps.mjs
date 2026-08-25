// Asserts that every bare specifier imported by a published source file is
// declared in `dependencies` or `devDependencies`.
//
// JSR builds its module graph from exactly those two fields. A package listed
// only under `peerDependencies` is invisible to it, so the bare specifier falls
// through to path resolution and the publish fails with a "Module not found"
// against a file that was never meant to exist. `jsr publish --dry-run` cannot
// see this: it resolves through the local node_modules, where pnpm has already
// auto-installed the peer.
//
// Specifiers come off the TypeScript AST rather than a regex, so the illustrative
// imports inside JSDoc `@example` blocks are not mistaken for real ones.

import { readFileSync, readdirSync, statSync } from 'node:fs'
import { isBuiltin } from 'node:module'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

import ts from 'typescript'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'))

const declared = new Set([
  ...Object.keys(pkg.dependencies ?? {}),
  ...Object.keys(pkg.devDependencies ?? {}),
])

const walk = (dir) =>
  readdirSync(dir).flatMap((entry) => {
    const path = join(dir, entry)
    return statSync(path).isDirectory() ? walk(path) : [path]
  })

// Mirrors the `exclude` list in jsr.json: tests are not part of the payload, so
// they cannot break the graph.
const published = walk(join(root, 'src')).filter(
  (file) => file.endsWith('.ts') && !/\.(test|spec)\.ts$/.test(file),
)

function specifiers(file) {
  const source = ts.createSourceFile(
    file,
    readFileSync(file, 'utf8'),
    ts.ScriptTarget.Latest,
    true,
  )
  const found = []

  const visit = (node) => {
    const isStatic =
      (ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) &&
      node.moduleSpecifier &&
      ts.isStringLiteral(node.moduleSpecifier)
    if (isStatic) found.push(node.moduleSpecifier.text)

    const isDynamic =
      ts.isCallExpression(node) &&
      node.expression.kind === ts.SyntaxKind.ImportKeyword &&
      node.arguments[0] &&
      ts.isStringLiteral(node.arguments[0])
    if (isDynamic) found.push(node.arguments[0].text)

    ts.forEachChild(node, visit)
  }

  visit(source)
  return found
}

const packageName = (specifier) =>
  specifier.startsWith('@')
    ? specifier.split('/').slice(0, 2).join('/')
    : specifier.split('/')[0]

const undeclared = new Map()
for (const file of published) {
  for (const specifier of specifiers(file)) {
    if (
      specifier.startsWith('.') ||
      specifier.startsWith('#') ||
      isBuiltin(specifier)
    ) {
      continue
    }
    const name = packageName(specifier)
    if (name === pkg.name || declared.has(name)) continue
    if (!undeclared.has(name)) undeclared.set(name, new Set())
    undeclared.get(name).add(file.slice(root.length + 1))
  }
}

if (undeclared.size === 0) {
  console.log(
    `ok   ${published.length} published sources, every bare import declared`,
  )
  process.exit(0)
}

console.error(
  `\n${undeclared.size} undeclared import(s). JSR publish will fail:\n`,
)
for (const [name, files] of undeclared) {
  const note = pkg.peerDependencies?.[name]
    ? ' (declared under peerDependencies only)'
    : ''
  console.error(`  ${name}${note}`)
  for (const file of files) console.error(`      ${file}`)
}
console.error('\nAdd each to devDependencies.\n')
process.exit(1)
