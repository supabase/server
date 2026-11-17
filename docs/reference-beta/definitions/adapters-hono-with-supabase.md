---
id: adapters-hono-with-supabase
kind: method
category: Adapters
title: withSupabase
symbol: "@supabase/server/adapters/hono.withSupabase"
summary: Hono middleware that creates a `SupabaseContext` and stores it in `c.var.supabaseContext`.
description: |-
  Hono middleware that creates a `SupabaseContext` and stores it in `c.var.supabaseContext`.

  Skips if a previous middleware already set the context, enabling route-level overrides.
  Throws a Hono `HTTPException` on auth failure.
signature: 'withSupabase<Database>(config?: Omit<WithSupabaseConfig, "cors">): MiddlewareHandler<{ Variables: { supabaseContext: SupabaseContext<Database> } }>'
stability: stable
deprecated: true
parameters:
  - name: config
    location: argument
    type: Omit<WithSupabaseConfig, "cors">
    required: false
    description: Auth modes and optional environment overrides. CORS is excluded — use Hono's `cors()`.
returns:
  type: "MiddlewareHandler<{ Variables: { supabaseContext: SupabaseContext<Database> } }>"
  description: A Hono middleware that sets `c.var.supabaseContext`.
throws: []
examples:
  - id: app-wide-auth-via-app-use
    title: App-wide auth via app.use()
    lang: ts
    code: |
      import { Hono } from 'hono'
      import { withSupabase } from '@supabase/server/adapters/hono'
      import type { SupabaseContext } from '@supabase/server'

      type Env = {
        Variables: {
          supabaseContext: SupabaseContext
        }
      }

      const app = new Hono<Env>()
      app.use('*', withSupabase({ auth: 'user' }))

      app.get('/profile', async (c) => {
        const { supabase } = c.var.supabaseContext
        const { data } = await supabase.rpc('get_profile')
        return c.json(data)
      })

      export default { fetch: app.fetch }
---

> **Deprecated:** Removed on December 1, 2026. Use the Hono bridge from the
  framework integration guide instead: https://supabase.com/docs/reference/server/frameworks
