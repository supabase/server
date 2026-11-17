---
id: middleware-admin-client-with-supabase-admin-client
kind: method
category: Middleware
title: withSupabaseAdminClient
symbol: "@supabase/server/middleware/admin-client.withSupabaseAdminClient"
summary: Contributes `ctx.supabaseAdmin` — an admin Supabase client that bypasses Row-Level Security, authenticated with a secret key. This is the same middleware `withSupabase` composes internally to build its context.
description: |-
  Contributes `ctx.supabaseAdmin` — an admin Supabase client that
  bypasses Row-Level Security, authenticated with a secret key. This is the
  same middleware `withSupabase` composes internally to build its context.

  The client is constructed on the first property access of
  `ctx.supabaseAdmin` and memoized for the request. A handler that never
  accesses it requires no secret key.
signature: "withSupabaseAdminClient<Database>(config?: WithSupabaseAdminClientConfig): Entry<{ supabaseAdmin: SupabaseClient<Database> }>"
stability: stable
deprecated: false
parameters:
  - name: config
    location: argument
    type: WithSupabaseAdminClientConfig
    required: false
    description: ""
returns:
  type: "Entry<{ supabaseAdmin: SupabaseClient<Database> }>"
  description: ""
throws:
  - type: EnvError
    description: |-
      When `SUPABASE_URL` or the secret key is
      missing — thrown at the first `ctx.supabaseAdmin` property access, inside
      the handler or downstream middleware that performs it.
examples:
  - id: standalone-pipeline
    title: Standalone pipeline
    lang: ts
    code: |
      import { pipeline } from '@supabase/middleware'
      import { withSupabaseAdminClient } from '@supabase/server/middleware/admin-client'

      export default {
        fetch: pipeline([withSupabaseAdminClient()], async (req, ctx) => {
          await ctx.supabaseAdmin.from('audit_log').insert({ action: 'ping' })
          return Response.json({ ok: true })
        }),
      }
---
