---
id: server-env-error
kind: class
category: Errors
title: EnvError
symbol: "@supabase/server.EnvError"
summary: Thrown when a required environment variable is missing or malformed.
description: |-
  Thrown when a required environment variable is missing or malformed.

  Always has `status: 500` — environment errors are server-side configuration issues.
signature: class EnvError extends SupabaseServerError
stability: stable
deprecated: false
parameters:
  - name: message
    location: argument
    type: string
    required: true
    description: Human-readable description. Prefixed with `[@supabase/server]`.
  - name: code
    location: argument
    type: string
    required: false
    description: Machine-readable code.
  - name: options
    location: argument
    type: SupabaseServerErrorOptions
    required: false
    description: Optional `hint`, `details`, `docs`, and `cause`.
    children:
      - name: hint
        location: argument
        type: string
        required: false
        description: Actionable next step for whoever has to fix this.
      - name: details
        location: argument
        type: Record<string, unknown>
        required: false
        description: |-
          Structured, non-sensitive diagnostics. Never contains key values, token
          payloads, or any other secret material.
      - name: docs
        location: argument
        type: string
        required: false
        description: Override the generated documentation URL.
      - name: cause
        location: argument
        type: unknown
        required: false
        description: Underlying error, when this one wraps another.
properties:
  - name: source
    location: property
    type: '"@supabase/server"'
    required: true
    description: Always `"@supabase/server"`.
  - name: code
    location: property
    type: string
    required: true
    description: Machine-readable error code.
  - name: hint
    location: property
    type: string
    required: false
    description: Actionable next step, when one applies.
  - name: docs
    location: property
    type: string
    required: true
    description: Documentation URL for this error's `code`.
  - name: details
    location: property
    type: Record<string, unknown>
    required: false
    description: |-
      Structured, non-sensitive diagnostics — accepted auth modes, which
      credential headers were present, configured key *names*, JWT header
      fields. Never key values or token payloads.
  - name: toJSON
    location: property
    type: () => ErrorPayload
    required: true
    description: ""
  - name: status
    location: property
    type: "500"
    required: true
    description: Always `500` — environment errors are server-side issues.
examples:
  - id: catching-an-env-error
    title: Catching an EnvError
    lang: ts
    code: |
      import { EnvError } from '@supabase/server'

      try {
        const client = createAdminClient()
      } catch (e) {
        if (e instanceof EnvError) {
          console.error(`[${e.code}] ${e.message}\n${e.hint}`)
          // → "[MISSING_SUPABASE_URL] [@supabase/server] SUPABASE_URL is required but not set."
          //   "Set SUPABASE_URL to your project URL (https://<project-ref>.supabase.co), …"
        }
      }
---
