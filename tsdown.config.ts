import { defineConfig } from 'tsdown'

export default defineConfig({
  entry: [
    'src/index.ts',
    'src/core/index.ts',
    'src/core/gates/index.ts',
    'src/core/adapters/index.ts',
    'src/adapters/hono/index.ts',
    'src/adapters/h3/index.ts',
    'src/gates/feature-flag/index.ts',
    'src/adapters/elysia/index.ts',
  ],
  format: ['esm', 'cjs'],
  dts: true,
  external: ['@supabase/supabase-js', 'hono', 'h3', 'elysia'],
})
