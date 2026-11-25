import { afterAll, beforeAll } from 'vitest'

import { start } from './apps/h3/app.ts'
import { runAppScenarios } from './scenarios.ts'

const PORT = 8792

let close: () => Promise<void>

beforeAll(async () => {
  close = await start(PORT)
})

afterAll(() => close())

runAppScenarios('h3', `http://localhost:${PORT}`)
