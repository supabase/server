---
id: server-auth-error
kind: class
category: Errors
title: AuthError
symbol: "@supabase/server.AuthError"
summary: Thrown when authentication or authorization fails.
description: |-
  Thrown when authentication or authorization fails.

  Carries an HTTP `status` code suitable for returning directly in a response
  (`401` when the request's credentials are at fault, `500` when the server is
  misconfigured and could not have authenticated anyone).
signature: class AuthError extends SupabaseServerError
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
  - name: status
    location: argument
    type: number
    required: false
    description: HTTP status. Defaults to `401`.
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
    type: number
    required: true
    description: |-
      HTTP status code.

      - `401` — The request's credentials are at fault (`MissingCredentialsError`,
        `InvalidApiKeyError`, `InvalidJwtError`).
      - `500` — The server is misconfigured (`JwksNotConfiguredError`,
        `NoKeysConfiguredError`, `JwksFetchFailedError`,
        `CreateSupabaseClientError`).
examples:
  - id: catching-an-auth-error
    title: Catching an AuthError
    lang: ts
    code: |
      import { createSupabaseContext } from '@supabase/server'

      const { data: ctx, error } = await createSupabaseContext(request, { auth: 'user' })
      if (error) {
        // error is an AuthError — `toJSON()` includes source, code, message, hint, docs, details
        return Response.json(error.toJSON(), { status: error.status })
      }
---
