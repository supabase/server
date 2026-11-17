---
id: middleware-postgres-request-claims
kind: type
category: Middleware
title: RequestClaims
symbol: "@supabase/server/middleware/postgres.RequestClaims"
summary: Minimal claims shape `withPostgresClient` needs on the upstream context.
description: |-
  Minimal claims shape `withPostgresClient` needs on the
  upstream context.

  Satisfied both by `withSupabase`'s JWKS-verified `ctx.jwtClaims` and by the
  standalone `withClaims` middleware — `withPostgresClient` only reads `role`
  and serializes the whole object into `request.jwt.claims`.
signature: interface RequestClaims
stability: stable
deprecated: false
properties:
  - name: role
    location: property
    type: string
    required: false
    description: ""
examples: []
---
