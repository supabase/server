import { afterAll, beforeAll } from 'vitest'

import { start } from './apps/elysia/app.ts'
import { runAdapterScenarios } from './scenarios.ts'

const PORT = 8793

let close: () => Promise<void>

beforeAll(async () => {
  close = await start(PORT)
})

afterAll(() => close())

runAdapterScenarios('elysia', `http://localhost:${PORT}`)
