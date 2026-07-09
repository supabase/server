import { afterAll, beforeAll } from 'vitest'

import { start } from './apps/nestjs/app.ts'
import { runAdapterScenarios } from './scenarios.ts'

const PORT = 8794

let close: () => Promise<void>

beforeAll(async () => {
  close = await start(PORT)
})

afterAll(() => close())

runAdapterScenarios('nestjs', `http://localhost:${PORT}`)
