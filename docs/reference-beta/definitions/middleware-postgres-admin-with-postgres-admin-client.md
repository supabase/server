---
id: middleware-postgres-admin-with-postgres-admin-client
kind: method
category: Middleware
title: withPostgresAdminClient
symbol: "@supabase/server/middleware/postgres-admin.withPostgresAdminClient"
summary: Contributes `ctx.postgresAdmin` — a `pg` client that **bypasses RLS**, for full-table access. The direct-connection counterpart to `withSupabaseAdminClient`, and the deliberate opt-out from the guardrails `withPostgresClient` (`@supabase/server/middleware/postgres`) enforces.
description: |-
  Contributes `ctx.postgresAdmin` — a `pg` client that **bypasses
  RLS**, for full-table access. The direct-connection counterpart to
  `withSupabaseAdminClient`, and the deliberate opt-out from the guardrails
  `withPostgresClient` (`@supabase/server/middleware/postgres`) enforces.

  Queries run as-is, as the role in the connection string: no claim injection,
  no role switching, no wrapping transaction. Whatever that role may read, the
  caller may read.

  Unlike `withPostgresClient` this declares **no upstream prerequisite** — it
  never looks at `ctx.jwtClaims`, so it composes in any auth mode, including
  `auth: 'secret'` and `auth: 'none'`:

  ```ts
  import { pipeline } from '@supabase/middleware'
  import { withSupabase } from '@supabase/server'
  import { withPostgresAdminClient } from '@supabase/server/middleware/postgres-admin'

  pipeline([withSupabase({ auth: 'secret' }), withPostgresAdminClient()], handler)
  ```

  Compose both halves when a handler needs each in turn — they share one pool,
  and `ctx.postgres` stays RLS-scoped regardless:

  ```ts
  pipeline([withSupabase({ auth: 'user' }), withPostgresClient(), withPostgresAdminClient()], handler)
  ```

  > **Authorization is yours now.** RLS is not consulted, so any per-user
  > scoping has to be a `where` clause you write. Reach for
  > `withPostgresClient` unless you specifically need to cross user
  > boundaries.

  > **Runtime note.** `pg` needs raw TCP, so this runs on Node/Deno (including
  > the Supabase Edge runtime), **not** on Workers-style isolates.
signature: "withPostgresAdminClient(config?: WithPostgresAdminClientConfig): Entry<{ postgresAdmin: PostgresApi }>"
stability: stable
deprecated: false
parameters:
  - name: config
    location: argument
    type: WithPostgresAdminClientConfig
    required: false
    description: ""
    children:
      - name: connectionString
        location: argument
        type: string
        required: false
        description: Defaults to `getEnv('SUPABASE_DB_URL')` (from `@supabase/middleware`).
      - name: pool
        location: argument
        type: PostgresPoolOptions
        required: false
        description: |-
          Pool size and checkout timeout for this connection string. Checked when
          the middleware is built; an invalid value throws a `RangeError` then.
          Entries whose options resolve to the same values share one pool.
        children:
          - name: max
            location: argument
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
            location: argument
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
        location: argument
        type: ErrorResponseConfig
        required: false
        description: How much of an error to include in a short-circuit response body.
        children:
          - name: detailed
            location: argument
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
returns:
  type: "Entry<{ postgresAdmin: PostgresApi }>"
  description: ""
throws: []
examples: []
---
