---
id: middleware-postgres-postgres-api
kind: type
category: Middleware
title: PostgresApi
symbol: "@supabase/server/middleware/postgres.PostgresApi"
summary: The shape of `ctx.postgres` and `ctx.postgresAdmin`.
description: |-
  The shape of `ctx.postgres` and `ctx.postgresAdmin`.

  Both halves expose the same surface — they differ in what runs around the
  query, not in how you call it. `withPostgresClient` wraps every query in a
  transaction that injects the caller's claims and drops to their role;
  `withPostgresAdminClient` runs it as-is, as the connection-string role.
signature: interface PostgresApi
stability: stable
deprecated: false
properties:
  - name: query
    location: property
    type: "(strings: TemplateStringsArray, ...values: unknown[]) => Promise<T[]>"
    required: true
    description: ""
  - name: queryRaw
    location: property
    type: "(text: string, params?: unknown[]) => Promise<T[]>"
    required: true
    description: ""
examples: []
---
