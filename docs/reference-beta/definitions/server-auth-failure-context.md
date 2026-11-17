---
id: server-auth-failure-context
kind: type
category: Errors
title: AuthFailureContext
symbol: "@supabase/server.AuthFailureContext"
summary: Everything the auth pipeline knows about a failed attempt, minus anything secret. Used to build messages, hints, and `details`.
description: |-
  Everything the auth pipeline knows about a failed attempt, minus anything
  secret. Used to build messages, hints, and `details`.
signature: interface AuthFailureContext
stability: stable
deprecated: false
properties:
  - name: authModes
    location: property
    type: readonly string[]
    required: true
    description: Auth modes that were attempted, in the order they were tried.
  - name: received
    location: property
    type: ReceivedCredentials
    required: true
    description: Which credential headers the request carried.
    children:
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
  - name: configuredKeyNames
    location: property
    type: Record<string, readonly string[]>
    required: false
    description: |-
      Names (never values) of the keys configured for the attempted modes.
      Omitted for modes that don't use API keys.
  - name: matchedKey
    location: property
    type: '{ kind: "publishable" | "secret"; name: string; mode: string }'
    required: false
    description: |-
      Set when the rejected `apikey` is a configured key of `kind` held under
      `name`, and `mode` is the attempted mode that accepts a different name.
      Carries the name only, never the value.
    children:
      - name: kind
        location: property
        type: '"publishable" | "secret"'
        required: true
        description: ""
      - name: name
        location: property
        type: string
        required: true
        description: ""
      - name: mode
        location: property
        type: string
        required: true
        description: ""
examples: []
---
