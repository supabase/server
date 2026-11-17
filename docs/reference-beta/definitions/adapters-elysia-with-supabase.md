---
id: adapters-elysia-with-supabase
kind: method
category: Adapters
title: withSupabase
symbol: "@supabase/server/adapters/elysia.withSupabase"
summary: Elysia plugin that creates a `SupabaseContext` and makes it available in route handlers.
description: |-
  Elysia plugin that creates a `SupabaseContext` and makes it available in route handlers.

  Skips if a previous plugin already set the context, enabling route-level overrides.
  Throws a `SupabaseError` on auth failure. `.status` is on the error directly; the original
  `AuthError` is available as the typed `.cause`. Discriminate in `onError` via `code === 'SupabaseError'`.
signature: 'withSupabase<Database>(config?: Omit<WithSupabaseConfig, "cors">): Elysia<"", { decorator: {}; store: {}; derive: {}; resolve: {} }, { typebox: {}; error: { SupabaseError: SupabaseError } }, { schema: {}; standaloneSchema: {}; macro: {}; macroFn: {}; parser: {}; response: {} }, {}, { derive: {}; resolve: { supabaseContext: SupabaseContext<Database> }; schema: {}; standaloneSchema: {}; response: ExtractErrorFromHandle<{ supabaseContext: SupabaseContext<Database> }> }, { derive: {}; resolve: {}; schema: {}; standaloneSchema: {}; response: {} }>'
stability: stable
deprecated: true
parameters:
  - name: config
    location: argument
    type: Omit<WithSupabaseConfig, "cors">
    required: false
    description: Auth modes and optional environment overrides. CORS is excluded — use Elysia's CORS utilities.
returns:
  type: 'Elysia<"", { decorator: {}; store: {}; derive: {}; resolve: {} }, { typebox: {}; error: { SupabaseError: SupabaseError } }, { schema: {}; standaloneSchema: {}; macro: {}; macroFn: {}; parser: {}; response: {} }, {}, { derive: {}; resolve: { supabaseContext: SupabaseContext<Database> }; schema: {}; standaloneSchema: {}; response: ExtractErrorFromHandle<{ supabaseContext: SupabaseContext<Database> }> }, { derive: {}; resolve: {}; schema: {}; standaloneSchema: {}; response: {} }>'
  description: An Elysia plugin that exposes `supabaseContext`.
throws: []
examples:
  - id: app-wide-auth-via-use
    title: App-wide auth via .use()
    lang: ts
    code: |
      import { Elysia } from 'elysia'
      import { withSupabase } from '@supabase/server/adapters/elysia'

      const app = new Elysia()
        .use(withSupabase({ auth: 'user' }))
        .get('/games', async ({ supabaseContext }) => {
          const { data } = await supabaseContext.supabase.from('favorite_games').select()
          return data
        })

      app.listen(3000)
  - id: per-route-auth-via-scoped-use
    title: Per-route auth via scoped .use()
    lang: ts
    code: |
      import { Elysia } from 'elysia'
      import { withSupabase } from '@supabase/server/adapters/elysia'

      const app = new Elysia()
        .get('/health', () => ({ status: 'ok' }))
        .group('/api', (app) =>
          app
            .use(withSupabase({ auth: 'user' }))
            .get('/profile', async ({ supabaseContext }) => {
              return supabaseContext.userClaims
            })
        )

      app.listen(3000)
---

> **Deprecated:** Removed on December 1, 2026. Use the Elysia bridge from the
  framework integration guide instead: https://supabase.com/docs/reference/server/frameworks
