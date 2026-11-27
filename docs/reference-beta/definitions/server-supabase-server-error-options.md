---
id: server-supabase-server-error-options
kind: type
category: Errors
title: SupabaseServerErrorOptions
symbol: "@supabase/server.SupabaseServerErrorOptions"
summary: Optional diagnostics attached to a `SupabaseServerError`.
description: Optional diagnostics attached to a `SupabaseServerError`.
signature: interface SupabaseServerErrorOptions
stability: stable
deprecated: false
properties:
  - name: hint
    location: property
    type: string
    required: false
    description: Actionable next step for whoever has to fix this.
  - name: details
    location: property
    type: Record<string, unknown>
    required: false
    description: |-
      Structured, non-sensitive diagnostics. Never contains key values, token
      payloads, or any other secret material.
  - name: docs
    location: property
    type: string
    required: false
    description: Override the generated documentation URL.
  - name: cause
    location: property
    type: unknown
    required: false
    description: Underlying error, when this one wraps another.
examples: []
---
