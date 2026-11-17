---
id: server-create-context-client-options
kind: type
category: Types
title: CreateContextClientOptions
symbol: "@supabase/server.CreateContextClientOptions"
summary: Options for `createContextClient`.
description: Options for `createContextClient`.
signature: interface CreateContextClientOptions
stability: stable
deprecated: false
properties:
  - name: auth
    location: property
    type: ClientAuth
    required: false
    description: Auth identity — token and key name from the verified request.
    children:
      - name: token
        location: property
        type: string | null
        required: false
        description: The caller's JWT, or `null` for anonymous access.
      - name: keyName
        location: property
        type: string | null
        required: false
        description: Name of the API key to use. Falls back to `"default"`, then first available.
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
