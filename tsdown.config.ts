import { defineConfig } from 'tsdown'

export default defineConfig({
  entry: [
    'src/index.ts',
    'src/core/index.ts',
    'src/peer/supabase-js/index.ts',
    'src/middleware/postgres/index.ts',
    'src/middleware/postgres-admin/index.ts',
    'src/middleware/claims/index.ts',
    'src/middleware/required-claims/index.ts',
    'src/middleware/client/index.ts',
    'src/middleware/admin-client/index.ts',
    'src/oauth-protected-resource/index.ts',
  ],
  format: ['esm', 'cjs'],
  dts: true,
  external: ['@supabase/supabase-js', 'pg'],
})
