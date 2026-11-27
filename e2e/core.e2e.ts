import { afterAll, beforeAll } from 'vitest'

import { start } from './apps/core/app.ts'
import { runAppScenarios, runPostgresScenarios } from './scenarios.ts'

const PORT = 8795
const baseUrl = `http://localhost:${PORT}`

let close: () => Promise<void>

beforeAll(async () => {
  close = await start(PORT)
})

afterAll(() => close())

runAppScenarios('core', baseUrl)
runPostgresScenarios('core', baseUrl)
