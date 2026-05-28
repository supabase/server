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
    ],
  },
})
