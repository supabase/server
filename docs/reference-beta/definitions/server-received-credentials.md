---
id: server-received-credentials
kind: type
category: Errors
title: ReceivedCredentials
symbol: "@supabase/server.ReceivedCredentials"
summary: Non-sensitive summary of the credentials a request carried.
description: Non-sensitive summary of the credentials a request carried.
signature: interface ReceivedCredentials
stability: stable
deprecated: false
properties:
  - name: authorization
    location: property
    type: '"absent" | "bearer" | "api-key" | "non-bearer-scheme"'
    required: true
    description: |-
      What the `Authorization` header carried.

      - `'bearer'` — a bearer token that looks like a JWT
      - `'api-key'` — an `sb_*` API key, which the Supabase SDK forwards here
        alongside the `apikey` header; not a user token
      - `'non-bearer-scheme'` — present but unusable (wrong scheme, wrong
        casing, bare value, empty token)
      - `'absent'` — no header
  - name: apikey
    location: property
    type: ApiKeyFormat
    required: true
    description: The `apikey` header classified by prefix. Never the value itself.
examples: []
---
