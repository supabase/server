import swc from 'unplugin-swc'
import { defineConfig } from 'vitest/config'

// SWC handles legacy decorators with metadata for the NestJS integration test.
// The default vitest transform (esbuild) doesn't emit decorator metadata, which
// NestJS needs to wire up controllers, guards, and DI.
export default defineConfig({
  plugins: [
    swc.vite({
      jsc: {
        parser: { syntax: 'typescript', decorators: true },
        transform: { decoratorMetadata: true, legacyDecorator: true },
      },
    }),
  ],
})
