import { afterAll, beforeAll } from 'vitest'

import { start } from './apps/core/app.ts'
import { runAdapterScenarios, runPostgresScenarios } from './scenarios.ts'

const PORT = 8795
const baseUrl = `http://localhost:${PORT}`

let close: () => Promise<void>

beforeAll(async () => {
  close = await start(PORT)
})

afterAll(() => close())

runAdapterScenarios('core', baseUrl)
runPostgresScenarios('core', baseUrl)
