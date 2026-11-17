---
id: server-create-admin-client-options
kind: type
category: Types
title: CreateAdminClientOptions
symbol: "@supabase/server.CreateAdminClientOptions"
summary: Options for `createAdminClient`.
description: Options for `createAdminClient`.
signature: interface CreateAdminClientOptions
stability: stable
deprecated: false
properties:
  - name: auth
    location: property
    type: Pick<ClientAuth, "keyName">
    required: false
    description: Auth identity — key name from the verified request.
  - name: env
    location: property
    type: Partial<SupabaseEnv>
    required: false
    description: Override auto-detected environment variables.
  - name: supabaseOptions
    location: property
    type: SupabaseClientOptions<string>
    required: false
    description: Options forwarded to `createClient()`. `accessToken` is stripped; auth settings are force-overwritten.
examples: []
---
