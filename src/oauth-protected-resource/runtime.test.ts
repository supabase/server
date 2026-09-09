import { afterEach, describe, expect, it, vi } from 'vitest'

import { isEdgeFunctions } from './runtime.js'

// `runtimeName` is a module-level constant in `@supabase/middleware` (std-env's
// `runtime`), so it is swapped per test through a getter; `getEnv` stays real.
const runtime = vi.hoisted(() => ({ name: 'node' }))
vi.mock('@supabase/middleware', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@supabase/middleware')>()
  return {
    ...actual,
    get runtimeName() {
      return runtime.name
    },
  }
})

/** Set env vars for one test, restoring prior values afterward. */
const testEnv = (
  globalThis as { process?: { env: Record<string, string | undefined> } }
).process!.env
const envCleanup: Array<() => void> = []
function setEnv(name: string, value: string | undefined) {
  const prior = testEnv[name]
  if (value === undefined) delete testEnv[name]
  else testEnv[name] = value
  envCleanup.push(() => {
    if (prior === undefined) delete testEnv[name]
    else testEnv[name] = prior
  })
}

afterEach(() => {
  while (envCleanup.length) envCleanup.pop()!()
  runtime.name = 'node'
})

describe('isEdgeFunctions', () => {
  it('is true when SUPABASE_FUNCTION_SLUG is set, whatever the runtime reports', () => {
    setEnv('SUPABASE_FUNCTION_SLUG', 'my-fn')
    setEnv('SB_EXECUTION_ID', undefined)
    runtime.name = 'node'
    expect(isEdgeFunctions()).toBe(true)
  })

  it('is true when SB_EXECUTION_ID is set and std-env reports edge-light (Supabase edge runtime exposes an EdgeRuntime global)', () => {
    setEnv('SUPABASE_FUNCTION_SLUG', undefined)
    setEnv('SB_EXECUTION_ID', '2f1a0c9e-7d5b-4b1e-9c3a-0f6d2b8e4a11')
    runtime.name = 'edge-light'
    expect(isEdgeFunctions()).toBe(true)
  })

  it('is true on a plain Deno runtime with no Supabase markers', () => {
    setEnv('SUPABASE_FUNCTION_SLUG', undefined)
    setEnv('SB_EXECUTION_ID', undefined)
    runtime.name = 'deno'
    expect(isEdgeFunctions()).toBe(true)
  })

  it('is false on Node with no Supabase markers', () => {
    setEnv('SUPABASE_FUNCTION_SLUG', undefined)
    setEnv('SB_EXECUTION_ID', undefined)
    runtime.name = 'node'
    expect(isEdgeFunctions()).toBe(false)
  })

  it('is false on a real edge-light runtime (Vercel Edge) with no Supabase markers', () => {
    setEnv('SUPABASE_FUNCTION_SLUG', undefined)
    setEnv('SB_EXECUTION_ID', undefined)
    runtime.name = 'edge-light'
    expect(isEdgeFunctions()).toBe(false)
  })
})
