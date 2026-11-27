import { readFileSync } from 'node:fs'

import { describe, expect, it } from 'vitest'

import { version } from './version.js'

const readJson = (path: string) =>
  JSON.parse(readFileSync(new URL(path, import.meta.url), 'utf8')) as {
    version: string
  }

describe('version', () => {
  it('equals the version in package.json', () => {
    expect(version).toBe(readJson('../package.json').version)
  })

  it('equals the version in jsr.json', () => {
    expect(version).toBe(readJson('../jsr.json').version)
  })
})
