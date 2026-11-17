---
id: server-credentials
kind: type
category: Types
title: Credentials
symbol: "@supabase/server.Credentials"
summary: Raw credentials extracted from an incoming HTTP request.
description: |-
  Raw credentials extracted from an incoming HTTP request.

  Produced by `extractCredentials` from the `Authorization` and `apikey` headers.
signature: interface Credentials
stability: stable
deprecated: false
properties:
  - name: token
    location: property
    type: string | null
    required: true
    description: "Bearer token from the `Authorization: Bearer <token>` header, or `null` if absent."
  - name: apikey
    location: property
    type: string | null
    required: true
    description: API key from the `apikey` header, or `null` if absent.
examples: []
---
