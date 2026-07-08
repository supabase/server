// Runs in every vitest worker before test files are imported, so the apps'
// resolveEnv() calls (which read process.env at request time) see the local
// stack's configuration.
import { loadEnv } from './load-env.ts'

loadEnv()
