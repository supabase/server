---
id: middleware-postgres-postgres-pool-options
kind: type
category: Middleware
title: PostgresPoolOptions
symbol: "@supabase/server/middleware/postgres.PostgresPoolOptions"
summary: Pool sizing for `withPostgresClient` and `withPostgresAdminClient`. Two entries on the same connection string share a pool only when their options resolve to the same values.
description: |-
  Pool sizing for `withPostgresClient` and
  `withPostgresAdminClient`. Two entries on the same connection string share
  a pool only when their options resolve to the same values.
signature: interface PostgresPoolOptions
stability: stable
deprecated: false
properties:
  - name: max
    location: property
    type: number
    required: false
    description: |-
      Connections this process opens at most on this connection string. A
      positive integer. The pooler team recommends one to four for serverless
      deployments.

      Default: ```ts
      4
      ```
  - name: checkoutTimeoutMs
    location: property
    type: number
    required: false
    description: |-
      Milliseconds a query waits for a free connection before failing with
      `POSTGRES_POOL_BUSY`, and how long a new connection may take to come up.
      A positive number. Keep it well under the pooler's own 60 second checkout
      timeout so the failure surfaces here, with a message that says what
      happened.

      Default: ```ts
      10000
      ```
examples: []
---
