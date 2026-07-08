import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

/**
 * Loads e2e/.env (written by `pnpm gen:env`) into process.env.
 *
 * Variables already present in process.env win, so CI or a developer can
 * export values directly instead of generating the file.
 */
export function loadEnv(): void {
  const envPath = fileURLToPath(new URL('../.env', import.meta.url))

  let raw: string
  try {
    raw = readFileSync(envPath, 'utf8')
  } catch {
    if (process.env.SUPABASE_URL) return
    throw new Error(
      'e2e/.env not found and SUPABASE_URL is not set. ' +
        'Start the local stack with `supabase start` (in e2e/), then run `pnpm gen:env`.',
    )
  }

  for (const line of raw.split('\n')) {
    const match = /^([A-Z0-9_]+)=(.*)$/.exec(line.trim())
    if (!match) continue
    const [, key, value] = match
    if (!(key in process.env)) process.env[key] = value
  }
}
