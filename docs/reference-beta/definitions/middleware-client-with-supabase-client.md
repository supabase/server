---
id: middleware-client-with-supabase-client
kind: method
category: Middleware
title: withSupabaseClient
symbol: "@supabase/server/middleware/client.withSupabaseClient"
summary: Contributes `ctx.supabase` — a Supabase client scoped to the caller's identity, so Row-Level Security policies apply. This is the same middleware `withSupabase` composes internally to build its context.
description: |-
  Contributes `ctx.supabase` — a Supabase client scoped to the
  caller's identity, so Row-Level Security policies apply. This is the same
  middleware `withSupabase` composes internally to build its context.

  Standalone, the caller's Bearer token (when present) is attached unverified —
  PostgREST verifies it on every query. Compose `withClaims`
  upstream when the pipeline itself needs verified claims.
signature: "withSupabaseClient<Database>(config?: WithSupabaseClientConfig): Entry<{ supabase: SupabaseClient<Database> }>"
stability: stable
deprecated: false
parameters:
  - name: config
    location: argument
    type: WithSupabaseClientConfig
    required: false
    description: ""
returns:
  type: "Entry<{ supabase: SupabaseClient<Database> }>"
  description: ""
throws:
  - type: EnvError
    description: |-
      When `SUPABASE_URL` or the publishable key is
      missing — composing wrappers (like `withSupabase`) map this to a 500
      response; standalone pipelines see it as a thrown error.
examples:
  - id: standalone-pipeline
    title: Standalone pipeline
    lang: ts
    code: |
      import { pipeline } from '@supabase/middleware'
      import { withSupabaseClient } from '@supabase/server/middleware/client'

      export default {
        fetch: pipeline([withSupabaseClient()], async (req, ctx) => {
          const { data } = await ctx.supabase.from('posts').select('id, title')
          return Response.json(data)
        }),
      }
---
