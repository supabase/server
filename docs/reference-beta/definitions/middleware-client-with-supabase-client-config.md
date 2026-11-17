---
id: middleware-client-with-supabase-client-config
kind: type
category: Middleware
title: WithSupabaseClientConfig
symbol: "@supabase/server/middleware/client.WithSupabaseClientConfig"
summary: Configuration for `withSupabaseClient` — the same environment and client options `createContextClient` accepts, minus the per-request auth identity (which is read from the request and the upstream context).
description: |-
  Configuration for `withSupabaseClient` — the same
  environment and client options `createContextClient` accepts, minus the
  per-request auth identity (which is read from the request and the upstream
  context).
signature: type WithSupabaseClientConfig = Omit<CreateContextClientOptions, "auth">
stability: stable
deprecated: false
examples: []
---
