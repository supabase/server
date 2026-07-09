import swc from 'unplugin-swc'
import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    projects: [
      {
        test: {
          name: 'unit',
          include: ['src/**/*.test.ts'],
          exclude: ['src/adapters/nestjs/**'],
        },
      },
      {
        plugins: [
          swc.vite({
            jsc: {
              parser: { syntax: 'typescript', decorators: true },
              transform: { decoratorMetadata: true, legacyDecorator: true },
            },
          }),
        ],
        test: {
          name: 'nestjs',
          include: ['src/adapters/nestjs/**/*.test.ts'],
        },
      },
      {
        // E2E suite — requires `pnpm build` and a running local Supabase
        // stack (see e2e/README.md). Excluded from plain `pnpm test`; run
        // with `pnpm test:e2e`. The swc plugin is needed for the NestJS
        // app's decorators.
        plugins: [
          swc.vite({
            jsc: {
              parser: { syntax: 'typescript', decorators: true },
              transform: { decoratorMetadata: true, legacyDecorator: true },
            },
          }),
        ],
        test: {
          name: 'e2e',
          include: ['e2e/**/*.e2e.ts'],
          globalSetup: ['e2e/setup/global-setup.ts'],
          setupFiles: ['e2e/setup/vitest-setup.ts'],
          testTimeout: 15000,
          hookTimeout: 30000,
        },
      },
    ],
  },
})
