---
id: adapters-h3-with-supabase
kind: method
category: Adapters
title: withSupabase
symbol: "@supabase/server/adapters/h3.withSupabase"
summary: H3 middleware that creates a `SupabaseContext` and stores it in `event.context.supabaseContext`.
description: |-
  H3 middleware that creates a `SupabaseContext` and stores it in `event.context.supabaseContext`.

  Skips if a previous middleware already set the context, enabling chained middleware via `app.use()`.
  Throws an `HTTPError` on auth failure.
signature: 'withSupabase(config?: Omit<WithSupabaseConfig, "cors">): Middleware'
stability: stable
deprecated: true
parameters:
  - name: config
    location: argument
    type: Omit<WithSupabaseConfig, "cors">
    required: false
    description: Auth modes and optional environment overrides. CORS is excluded — use H3's CORS utilities.
returns:
  type: Middleware
  description: An H3 middleware.
throws: []
examples:
  - id: app-wide-auth-via-app-use
    title: App-wide auth via app.use()
    lang: ts
    code: |
      import { H3 } from 'h3'
      import { withSupabase } from '@supabase/server/adapters/h3'

      const app = new H3()
      app.use(withSupabase({ auth: 'user' }))

      app.get('/games', async (event) => {
        const { supabase } = event.context.supabaseContext
        return supabase.from('favorite_games').select()
      })

      export default { fetch: app.fetch }
  - id: per-route-auth-via-define-handler
    title: Per-route auth via defineHandler
    lang: ts
    code: |
      import { defineHandler } from 'h3'
      import { withSupabase } from '@supabase/server/adapters/h3'

      export default defineHandler({
        middleware: [withSupabase({ auth: 'user' })],
        handler: async (event) => {
          const { supabase } = event.context.supabaseContext
          return supabase.from('favorite_games').select()
        },
      })
---

> **Deprecated:** Removed on December 1, 2026. Use the H3 bridge from the
  framework integration guide instead: https://supabase.com/docs/reference/server/frameworks
