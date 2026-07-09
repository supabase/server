import { afterAll, beforeAll } from 'vitest'

import { start } from './apps/core/app.ts'
import { runAdapterScenarios } from './scenarios.ts'

const PORT = 8795

let close: () => Promise<void>

beforeAll(async () => {
  close = await start(PORT)
})

afterAll(() => close())

runAdapterScenarios('core', `http://localhost:${PORT}`)
