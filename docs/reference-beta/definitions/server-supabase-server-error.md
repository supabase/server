---
id: server-supabase-server-error
kind: class
category: Errors
title: SupabaseServerError
symbol: "@supabase/server.SupabaseServerError"
summary: Base class for every error `@supabase/server` produces.
description: |-
  Base class for every error `@supabase/server` produces.

  Catch this to handle anything originating from this library, regardless of
  whether it's an `EnvError` or an `AuthError`:
signature: class SupabaseServerError extends Error
stability: stable
deprecated: false
parameters:
  - name: message
    location: argument
    type: string
    required: true
    description: ""
  - name: code
    location: argument
    type: string
    required: true
    description: ""
  - name: options
    location: argument
    type: SupabaseServerErrorOptions
    required: false
    description: ""
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
  - name: status
    location: property
    type: number
    required: true
    description: HTTP status code appropriate for this error.
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
examples:
  - id: catching-any-library-error
    title: Catching any library error
    lang: ts
    code: |
      import { SupabaseServerError } from '@supabase/server'

      try {
        const supabase = createAdminClient()
      } catch (e) {
        if (e instanceof SupabaseServerError) {
          console.error(e.code, e.message, e.hint, e.docs)
          return Response.json(e.toJSON(), { status: e.status })
        }
        throw e
      }
---
