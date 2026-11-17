// Experiment: turns typedoc's JSON output into one de-referenced Markdown file
// per documented definition under docs/reference-beta/definitions/.
//
// Each file is YAML frontmatter (the whole definition) plus optional notes.
// "De-referenced" means everything a reader needs is inlined: option interfaces
// become nested `children`, and `{@link X}` becomes the name of X.
//
// Run after typedoc has produced api-docs/spec.json: `pnpm docs:reference-beta`.

import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

import { stringify } from 'yaml'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const outDir = resolve(root, 'docs/reference-beta/definitions')
const spec = JSON.parse(
  readFileSync(resolve(root, 'api-docs/spec.json'), 'utf8'),
)

// Every declaration by id, so references and links can be followed.
const byId = new Map()
const index = (r) => {
  byId.set(r.id, r)
  r.children?.forEach(index)
}
index(spec)
// Follows re-exports (`export { X } from ...`) to the real declaration.
const decl = (id) => {
  const d = byId.get(id)
  return d?.variant === 'reference' ? decl(d.target) : d
}

const slug = (s) =>
  s
    .replace(/([a-z\d])([A-Z])/g, '$1-$2')
    .toLowerCase()
    .replace(/[^a-z\d]+/g, '-')
    .replace(/^-|-$/g, '')

// Comment parts -> plain Markdown; links are replaced by the target's name.
const text = (parts = []) =>
  parts
    .map((p) =>
      p.kind === 'inline-tag'
        ? `\`${decl(p.target)?.name ?? p.text}\``
        : p.text,
    )
    .join('')
    .trim()

// --- types -> strings -------------------------------------------------------

const sigType = (s) => `(${params(s)}) => ${type(s.type)}`
const params = (s) =>
  (s.parameters ?? [])
    .map(
      (p) =>
        `${p.flags.isRest ? '...' : ''}${p.name}${p.flags.isOptional ? '?' : ''}: ${type(p.type)}`,
    )
    .join(', ')
const memberType = (m) => (m.type ? type(m.type) : sigType(m.signatures[0]))

const type = (t) => {
  switch (t.type) {
    case 'intrinsic':
      return t.name
    case 'literal':
      return JSON.stringify(t.value)
    case 'reference':
      return t.typeArguments
        ? `${t.name}<${t.typeArguments.map(type).join(', ')}>`
        : t.name
    case 'array': {
      const e = type(t.elementType)
      return /[|&]|=>/.test(e) ? `(${e})[]` : `${e}[]`
    }
    case 'union':
      return t.types.map(type).join(' | ')
    case 'intersection':
      return t.types.map(type).join(' & ')
    case 'typeOperator':
      return `${t.operator} ${type(t.target)}`
    case 'tuple':
      return `[${(t.elements ?? []).map(type).join(', ')}]`
    case 'rest':
      return `...${type(t.elementType)}`
    case 'templateLiteral':
      return `\`${t.head}${t.tail.map(([ty, s]) => `\${${type(ty)}}${s}`).join('')}\``
    case 'reflection': {
      const d = t.declaration
      if (d.signatures) return sigType(d.signatures[0])
      const props = (d.children ?? []).map(
        (c) => `${c.name}${c.flags.isOptional ? '?' : ''}: ${memberType(c)}`,
      )
      return props.length ? `{ ${props.join('; ')} }` : '{}'
    }
    default:
      return t.type
  }
}

// --- parameters ---------------------------------------------------------------

// Summary plus the tags that don't have a field of their own in the schema.
const describe = (comment) =>
  [
    text(comment?.summary),
    ...(comment?.blockTags ?? [])
      .filter((b) => b.tag === '@deprecated' || b.tag === '@defaultValue')
      .map(
        (b) =>
          `${b.tag === '@deprecated' ? 'Deprecated.' : 'Default:'} ${text(b.content)}`,
      ),
  ]
    .filter(Boolean)
    .join('\n\n')

// Nested fields of a type: inlines interfaces and object type aliases.
const members = (t, seen, location) => {
  if (t?.type === 'intersection')
    return t.types.flatMap((x) => members(x, seen, location))
  if (t?.type === 'reflection')
    return fields(t.declaration.children, seen, location)
  if (t?.type === 'reference' && !seen.includes(t.target)) {
    const d = decl(t.target)
    const next = [...seen, t.target]
    if (d?.kind === 256) return fields(d.children, next, location) // interface
    if (d?.kind === 2097152) return members(d.type, next, location) // type alias
  }
  return []
}

const fields = (list = [], seen, location) =>
  list.map((p) => field(p, seen, location))

// `location` is `argument` for call parameters and `property` for the members
// of types and classes; nested children inherit it.
const field = (p, seen, location = 'argument') => {
  const children = members(p.type, seen, location)
  return {
    name: p.name,
    location,
    type: memberType(p),
    // A parameter's default makes it optional; a property's is just its initializer.
    required:
      !p.flags.isOptional &&
      (location === 'property' || p.defaultValue === undefined),
    description: describe(p.comment),
    ...(children.length && { children }),
  }
}

// `const withX = defineMiddleware(...)` is typed as the callable interface
// `Middleware<Key, Config, In, Contribution>`, which typedoc doesn't expand.
// Synthesize its config-only call, `withX(config?) => Entry<{ [Key]: Contribution }>`.
const middlewareSig = (d) => {
  const [key, config, , contribution] = d.type.typeArguments
  const all = config.type === 'union' ? config.types : [config]
  const [cfg] = all.filter((t) => !['void', 'undefined'].includes(t.name))
  return {
    parameters: cfg
      ? [{ name: 'config', type: cfg, flags: { isOptional: all.length > 1 } }]
      : [],
    type: {
      type: 'intrinsic',
      name: `Entry<{ ${key.value}: ${type(contribution)} }>`,
    },
  }
}

const signatureOf = (d) =>
  d.signatures?.[0] ??
  d.type?.declaration?.signatures?.[0] ??
  (d.type?.package === '@supabase/middleware' && middlewareSig(d))

// --- definitions --------------------------------------------------------------

const generics = (x) =>
  x.typeParameters ? `<${x.typeParameters.map((p) => p.name).join(', ')}>` : ''

const toDefinition = (mod, d) => {
  const callable = d.kind === 64 || d.kind === 32
  const sig = callable && signatureOf(d)
  const ctor = d.children?.find((c) => c.kind === 512)?.signatures[0]
  const comment = sig?.comment ?? d.comment
  const tags = (name) => comment?.blockTags?.filter((b) => b.tag === name) ?? []

  // Only what the library files under a @category is public documentation.
  const category = text(tags('@category')[0]?.content)
  if (!category) return null

  const mods = comment?.modifierTags ?? []
  const description = text(comment?.summary)
  const modPath = mod.name === 'index' ? '' : mod.name
  const extended = d.extendedTypes?.map(type).join(', ')

  const [deprecated] = tags('@deprecated')
  const remarks = tags('@remarks').map((t) => text(t.content))
  const notes = [
    deprecated && `> **Deprecated:** ${text(deprecated.content)}`,
    ...remarks,
  ].filter(Boolean)

  // Members of classes, interfaces, type aliases and object constants.
  const properties = sig
    ? []
    : d.kind === 128
      ? fields(
          d.children.filter((c) => c.kind !== 512),
          [d.id],
          'property',
        )
      : members(
          d.kind === 32 ? d.type : { type: 'reference', target: d.id },
          [],
          'property',
        )

  const frontmatter = {
    id: slug(`${modPath || 'server'}-${d.name}`),
    kind: sig
      ? 'method'
      : ({ 128: 'class' }[d.kind] ?? (d.kind === 32 ? 'constant' : 'type')),
    category,
    title: d.name,
    symbol: `${['@supabase/server', modPath].filter(Boolean).join('/')}.${d.name}`,
    summary: description.split('\n\n')[0].replace(/\n/g, ' '),
    description,
    signature: sig
      ? `${d.name}${generics(sig)}(${params(sig)}): ${type(sig.type)}`
      : d.kind === 2097152
        ? `type ${d.name}${generics(d)} = ${type(d.type)}`
        : d.kind === 32
          ? `const ${d.name}: ${type(d.type)}`
          : `${d.kind === 128 ? 'class' : 'interface'} ${d.name}${generics(d)}${extended ? ` extends ${extended}` : ''}`,
    stability: mods.some((m) => ['@alpha', '@experimental'].includes(m))
      ? 'experimental'
      : mods.includes('@beta')
        ? 'beta'
        : 'stable',
    deprecated: Boolean(deprecated),
    ...((sig || ctor) && {
      parameters: ((sig || ctor).parameters ?? []).map((p) => field(p, [])),
    }),
    ...(properties.length && { properties }),
    ...(sig && {
      returns: {
        type: type(sig.type),
        description: text(tags('@returns')[0]?.content),
      },
      throws: tags('@throws').map((t) => {
        const [first, ...rest] = t.content
        return first.kind === 'inline-tag'
          ? {
              type: decl(first.target)?.name ?? first.text,
              description: text(rest),
            }
          : { description: text(t.content) }
      }),
    }),
    examples: tags('@example').map((e, i) => {
      const code = text(e.content)
      const fence = code.match(/```(\w*)\n([\s\S]*?)\n```/)
      const title = e.name ?? `Example ${i + 1}`
      return {
        id: slug(title),
        title,
        lang: fence?.[1] || 'ts',
        code: `${fence?.[2] ?? code}\n`,
      }
    }),
  }

  const body = notes.length ? `\n${notes.join('\n\n')}\n` : ''
  return {
    id: frontmatter.id,
    content: `---\n${stringify(frontmatter, { lineWidth: 0 })}---\n${body}`,
  }
}

rmSync(outDir, { recursive: true, force: true })
mkdirSync(outDir, { recursive: true })

let count = 0
for (const mod of spec.children) {
  for (const d of mod.children ?? []) {
    // Re-exports have no comment of their own, so they drop out with the
    // uncategorized ones; they're documented under their original module.
    const def = toDefinition(mod, d)
    if (!def) continue
    writeFileSync(resolve(outDir, `${def.id}.md`), def.content)
    count++
  }
}
console.log(`Wrote ${count} definitions to ${outDir}`)
