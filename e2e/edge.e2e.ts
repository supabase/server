import { beforeAll } from 'vitest'

import { runAdapterScenarios } from './scenarios.ts'

// Served by the local stack's edge runtime (`supabase start` with
// [edge_runtime] enabled in e2e/supabase/config.toml) and reached through
// the Kong gateway — unlike the app suites, there is no local server to
// start. vitest-setup.ts has already loaded e2e/.env by the time this
// module is evaluated.
const baseUrl = `${process.env.SUPABASE_URL}/functions/v1/server-e2e`

beforeAll(async () => {
  // The first invocation boots the Deno worker and resolves its npm:
  // imports — poll /health so the cold start is spent here, not inside the
  // first scenario's 15s timeout.
  const deadline = Date.now() + 90_000
  for (;;) {
    try {
      const res = await fetch(`${baseUrl}/health`)
      if (res.ok) return
    } catch {
      // gateway not answering yet
    }
    if (Date.now() > deadline) {
      throw new Error(
        `edge function at ${baseUrl} not ready after 90s — is the stack ` +
          'running with [edge_runtime] enabled and the vendor step done? ' +
          '(pnpm vendor:e2e, then supabase start in e2e/)',
      )
    }
    await new Promise((resolve) => setTimeout(resolve, 1000))
  }
}, 120_000)

runAdapterScenarios('edge', baseUrl)
