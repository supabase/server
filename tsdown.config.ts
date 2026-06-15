import { defineConfig } from 'tsdown'

export default defineConfig({
  entry: [
    'src/index.ts',
    'src/core/index.ts',
    'src/peer/supabase-js/index.ts',
    'src/adapters/hono/index.ts',
    'src/adapters/h3/index.ts',
    'src/adapters/elysia/index.ts',
    'src/adapters/nestjs/index.ts',
    'src/adapters/tanstack-start/index.ts',
  ],
  format: ['esm', 'cjs'],
  dts: true,
  external: [
    '@supabase/supabase-js',
    'hono',
    'h3',
    'elysia',
    '@nestjs/common',
    '@tanstack/start-client-core',
  ],
})
