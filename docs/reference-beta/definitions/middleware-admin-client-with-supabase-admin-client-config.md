---
id: middleware-admin-client-with-supabase-admin-client-config
kind: type
category: Middleware
title: WithSupabaseAdminClientConfig
symbol: "@supabase/server/middleware/admin-client.WithSupabaseAdminClientConfig"
summary: Configuration for `withSupabaseAdminClient` — the same environment and client options `createAdminClient` accepts, minus the per-request auth identity (which is read from the upstream context).
description: |-
  Configuration for `withSupabaseAdminClient` — the same
  environment and client options `createAdminClient` accepts, minus the
  per-request auth identity (which is read from the upstream context).
signature: type WithSupabaseAdminClientConfig = Omit<CreateAdminClientOptions, "auth">
stability: stable
deprecated: false
examples: []
---
