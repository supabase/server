---
id: middleware-postgres-with-postgres-client
kind: method
category: Middleware
title: withPostgresClient
symbol: "@supabase/server/middleware/postgres.withPostgresClient"
summary: Contributes `ctx.postgres` — an RLS-scoped `pg` client, the safe version of "authenticate, then query as the user". This is the direct-connection counterpart to `withSupabaseClient`, and its service-role companion is `withPostgresAdminClient` (`@supabase/server/middleware/postgres-admin`).
description: |-
  Contributes `ctx.postgres` — an RLS-scoped `pg` client, the safe
  version of "authenticate, then query as the user". This is the
  direct-connection counterpart to `withSupabaseClient`, and its service-role
  companion is `withPostgresAdminClient`
  (`@supabase/server/middleware/postgres-admin`).

  Every query runs in its own short transaction that injects the caller's
  claims and drops to their role, exactly like PostgREST:

  ```sql
  begin;
  select set_config('request.jwt.claims', $claims, true);  -- auth.uid() resolves
  set local role "authenticated";                          -- RLS now enforces
  <your query>
  commit;
  ```

  Everything is transaction-local, so nothing leaks onto the pooled connection.

  Only `authenticated` and `anon` are assumed. A token naming any other role —
  including `service_role` — is **refused** with a 500 and
  `code: 'UNSUPPORTED_ROLE'`, never silently downgraded to `anon`: running the
  query as the wrong identity would return zero rows and leave nothing to
  debug. Bypassing RLS is a separate, explicit opt-in: compose
  `withPostgresAdminClient`.

  > **Custom roles.** Supabase supports custom Postgres roles via the `role`
  > claim, and RLS still applies to them. They are not supported here yet, so
  > such a token is refused rather than downgraded.

  Reads the caller's claims from `ctx.jwtClaims`, which `withSupabase`
  populates (JWKS-verified) — so after `withSupabase` in a pipeline it composes
  directly:

  ```ts
  pipeline([withSupabase({ auth: 'user' }), withPostgresClient()], handler)
  ```

  Standalone (no `withSupabase`), pair it with `withClaims` so `ctx.jwtClaims`
  is present before it runs.

  > **Table grants.** Queries run as `authenticated` or `anon`, so those
  > roles need explicit table privileges (e.g. `grant select, insert on
  > <table> to authenticated`) in addition to RLS policies. A missing grant
  > fails with `permission denied` (SQLSTATE 42501) before RLS is consulted.

  > **Runtime note.** `pg` needs raw TCP, so this runs on Node/Deno (including
  > the Supabase Edge runtime), **not** on Workers-style isolates.
signature: "withPostgresClient(config?: WithPostgresClientConfig): Entry<{ postgres: PostgresApi }>"
stability: stable
deprecated: false
parameters:
  - name: config
    location: argument
    type: WithPostgresClientConfig
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
  type: "Entry<{ postgres: PostgresApi }>"
  description: ""
throws: []
examples: []
---
