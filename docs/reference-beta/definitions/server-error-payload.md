---
id: server-error-payload
kind: type
category: Errors
title: ErrorPayload
symbol: "@supabase/server.ErrorPayload"
summary: Serializable form of a `SupabaseServerError` — the exact JSON body `withSupabase` returns on failure.
description: |-
  Serializable form of a `SupabaseServerError` — the exact JSON body
  `withSupabase` returns on failure.
signature: interface ErrorPayload
stability: stable
deprecated: false
properties:
  - name: source
    location: property
    type: '"@supabase/server"'
    required: true
    description: Always `"@supabase/server"`. Identifies which library produced the error.
  - name: code
    location: property
    type: string
    required: true
    description: Machine-readable error code, also sent as the `x-supabase-server-error` header.
  - name: message
    location: property
    type: string
    required: true
    description: Human-readable description, prefixed with `[@supabase/server]`.
  - name: hint
    location: property
    type: string
    required: false
    description: Actionable next step. Omitted when there isn't a useful one.
  - name: docs
    location: property
    type: string
    required: true
    description: Documentation URL for this specific code.
  - name: details
    location: property
    type: Record<string, unknown>
    required: false
    description: Structured, non-sensitive diagnostics. Omitted when there are none.
examples: []
---
