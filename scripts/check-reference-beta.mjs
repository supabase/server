// Validates every generated docs/reference-beta/definitions/*.md against the
// docs project's frontmatter schema (docs/reference-beta/definition.schema.json,
// a vendored copy of definition.schema.json from the supabase docs app).
//
// Beyond the schema, `id` must equal the file name — JSON Schema can't express
// that. Exits non-zero when any definition is invalid.
//
// Run after generating: `pnpm docs:reference-beta` (which runs this) or
// `pnpm docs:check`.

import { readdirSync, readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

import Ajv from 'ajv/dist/2020.js'
import { parse } from 'yaml'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const dir = resolve(root, 'docs/reference-beta/definitions')
const schema = JSON.parse(
  readFileSync(resolve(root, 'docs/reference-beta/definition.schema.json')),
)

const validate = new Ajv({ allErrors: true }).compile(schema)

const files = readdirSync(dir).filter((f) => f.endsWith('.md'))
if (files.length === 0) {
  console.error(`No definitions found in ${dir} — run pnpm docs:reference-beta`)
  process.exit(1)
}

let invalid = 0
for (const file of files) {
  const errors = []
  const match = readFileSync(resolve(dir, file), 'utf8').match(
    /^---\n([\s\S]*?)\n---/,
  )
  if (!match) {
    errors.push('missing YAML frontmatter')
  } else {
    const data = parse(match[1])
    if (!validate(data)) {
      errors.push(
        ...validate.errors.map(
          (e) =>
            `${e.instancePath || '/'} ${e.message}${
              e.params.additionalProperty
                ? `: ${e.params.additionalProperty}`
                : ''
            }`,
        ),
      )
    }
    if (data?.id !== file.replace(/\.md$/, '')) {
      errors.push(`id "${data?.id}" does not match the file name`)
    }
  }
  if (errors.length) {
    invalid++
    console.error(`✗ ${file}\n${errors.map((e) => `    ${e}`).join('\n')}`)
  }
}

if (invalid) {
  console.error(`\n${invalid} of ${files.length} definitions are invalid`)
  process.exit(1)
}
console.log(`All ${files.length} definitions match the schema`)
