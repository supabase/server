---
id: server-from-supabase-url
kind: method
category: Middleware
title: fromSupabaseUrl
symbol: "@supabase/server.fromSupabaseUrl"
summary: Points `authorizationServer` at a Supabase project's Auth issuer.
description: |-
  Points `authorizationServer` at a Supabase project's Auth
  issuer.

  Use this off Supabase Edge Functions, where the app's own origin is unrelated
  to the Supabase project's, so the issuer cannot be derived from the request.
signature: "fromSupabaseUrl(supabaseUrl: string): string"
stability: stable
deprecated: false
parameters:
  - name: supabaseUrl
    location: argument
    type: string
    required: true
    description: |-
      The project URL, e.g. `https://<ref>.supabase.co` (the
      same value passed to `createClient()`).
returns:
  type: string
  description: ""
throws: []
examples:
  - id: example-1
    title: Example 1
    lang: ts
    code: |
      import { withOAuthProtectedResource, fromSupabaseUrl } from '@supabase/server'

      withOAuthProtectedResource(
        {
          resourceServer: (req) => new URL(req.url).origin + '/api/mcp',
          authorizationServer: fromSupabaseUrl('https://abc123.supabase.co'),
        },
        handler,
      )
---
