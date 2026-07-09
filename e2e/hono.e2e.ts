import { afterAll, beforeAll } from 'vitest'

import { start } from './apps/hono/app.ts'
import { runAdapterScenarios } from './scenarios.ts'

const PORT = 8791

let close: () => Promise<void>

beforeAll(async () => {
  close = await start(PORT)
})

afterAll(() => close())

runAdapterScenarios('hono', `http://localhost:${PORT}`)
