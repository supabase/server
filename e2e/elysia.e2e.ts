import { afterAll, beforeAll } from 'vitest'

import { start } from './apps/elysia/app.ts'
import { runAppScenarios } from './scenarios.ts'

const PORT = 8793

let close: () => Promise<void>

beforeAll(async () => {
  close = await start(PORT)
})

afterAll(() => close())

runAppScenarios('elysia', `http://localhost:${PORT}`)
