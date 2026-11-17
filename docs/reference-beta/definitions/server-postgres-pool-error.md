---
id: server-postgres-pool-error
kind: class
category: Errors
title: PostgresPoolError
symbol: "@supabase/server.PostgresPoolError"
summary: "Thrown when the Postgres pool cannot hand a query a connection: every pooled connection stayed busy for the whole checkout wait, or new connection attempts are paused after one failed."
description: |-
  Thrown when the Postgres pool cannot hand a query a connection: every pooled
  connection stayed busy for the whole checkout wait, or new connection
  attempts are paused after one failed.

  Always has `status: 503`. Both conditions are transient, so the request can
  be retried. `details.retryAfterMs` gives the time left when a pause is
  running.

  `ctx.postgres` and `ctx.postgresAdmin` throw this from the query call. The
  middleware do not turn it into a response; the handler or the host's error
  handler decides how the request answers.
signature: class PostgresPoolError extends SupabaseServerError
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
    required: true
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
    type: "503"
    required: true
    description: Always `503`. Nothing about the request is wrong; the pool has no connection for it yet.
examples:
  - id: answering-503-with-a-retry-after-header
    title: Answering 503 with a Retry-After header
    lang: ts
    code: |
      import { PostgresPoolError } from '@supabase/server'

      try {
        return Response.json(await ctx.postgres.query`select * from notes`)
      } catch (e) {
        if (e instanceof PostgresPoolError) {
          const retryAfterMs = Number(e.details?.retryAfterMs ?? 1000)
          return Response.json(e.toJSON(), {
            status: e.status,
            headers: { 'Retry-After': String(Math.ceil(retryAfterMs / 1000)) },
          })
        }
        throw e
      }
---
