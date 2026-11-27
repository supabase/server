import { afterAll, beforeAll } from 'vitest'

import { start } from './apps/nestjs/app.ts'
import { runAppScenarios } from './scenarios.ts'

const PORT = 8794

let close: () => Promise<void>

beforeAll(async () => {
  close = await start(PORT)
})

afterAll(() => close())

runAppScenarios('nestjs', `http://localhost:${PORT}`)
