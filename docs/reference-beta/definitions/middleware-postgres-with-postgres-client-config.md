---
id: middleware-postgres-with-postgres-client-config
kind: type
category: Middleware
title: WithPostgresClientConfig
symbol: "@supabase/server/middleware/postgres.WithPostgresClientConfig"
summary: Configuration for `withPostgresClient`.
description: Configuration for `withPostgresClient`.
signature: interface WithPostgresClientConfig extends ShortCircuitConfig
stability: stable
deprecated: false
properties:
  - name: connectionString
    location: property
    type: string
    required: false
    description: Defaults to `getEnv('SUPABASE_DB_URL')` (from `@supabase/middleware`).
  - name: pool
    location: property
    type: PostgresPoolOptions
    required: false
    description: |-
      Pool size and checkout timeout for this connection string. Checked when
      the middleware is built; an invalid value throws a `RangeError` then.
      Entries whose options resolve to the same values share one pool.
    children:
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
  - name: errors
    location: property
    type: ErrorResponseConfig
    required: false
    description: How much of an error to include in a short-circuit response body.
    children:
      - name: detailed
        location: property
        type: boolean
        required: false
        description: |-
          Whether to include the diagnostic fields in the response body.

          `hint` names the likely misconfiguration, `details` reports the endpoint's
          accepted auth modes, which credential headers arrived, and the *names* of
          configured keys, and `docs` links the relevant reference. All three are
          aimed at whoever is building against the endpoint.

          Set to `false` to reduce the body to `code` and `message` alone. The
          `x-supabase-server-error` header and the HTTP status are unaffected, and
          `message` keeps its `[@supabase/server]` prefix — so the error stays
          traceable without the `source` field.

          Default: `true`
examples: []
---
