---
id: server-client-auth
kind: type
category: Types
title: ClientAuth
symbol: "@supabase/server.ClientAuth"
summary: Auth identity for client creation functions.
description: Auth identity for client creation functions.
signature: interface ClientAuth
stability: stable
deprecated: false
properties:
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
examples: []
---
