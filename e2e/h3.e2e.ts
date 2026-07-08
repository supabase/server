import { afterAll, beforeAll } from 'vitest'

import { start } from './apps/h3/app.ts'
import { runAdapterScenarios } from './scenarios.ts'

const PORT = 8792

let close: () => Promise<void>

beforeAll(async () => {
  close = await start(PORT)
})

afterAll(() => close())

runAdapterScenarios('h3', `http://localhost:${PORT}`)
