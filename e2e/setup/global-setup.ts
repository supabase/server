import type { TestProject } from 'vitest/node'

import { mintForgedToken } from './forge-token.ts'
import { loadEnv } from './load-env.ts'
import { signInTestUser, type TestUser } from './token.ts'

declare module 'vitest' {
  interface ProvidedContext {
    e2eUsers: { user1: TestUser; user2: TestUser }
    forgedToken: string
  }
}

export default async function setup(project: TestProject) {
  loadEnv()

  const url = process.env.SUPABASE_URL
  const anonKey =
    process.env.SUPABASE_ANON_KEY ?? process.env.SUPABASE_PUBLISHABLE_KEY

  try {
    const res = await fetch(`${url}/auth/v1/health`, {
      headers: { apikey: anonKey ?? '' },
    })
    if (!res.ok) throw new Error(`auth health returned ${res.status}`)
  } catch (cause) {
    throw new Error(
      `Local Supabase stack is not reachable at ${url}. ` +
        'Run `supabase start` (in e2e/) and `pnpm gen:env`, then retry.',
      { cause },
    )
  }

  // Two users: user1 drives the happy-path scenarios, user2 exists solely to
  // prove data isolation (it must never insert notes).
  const user1 = await signInTestUser(
    'e2e-user-1@example.com',
    'password-user-1',
  )
  const user2 = await signInTestUser(
    'e2e-user-2@example.com',
    'password-user-2',
  )
  project.provide('e2eUsers', { user1, user2 })

  // Well-formed JWT with the real kid but the wrong signing key — must 401.
  project.provide('forgedToken', await mintForgedToken(user1.id))
}
