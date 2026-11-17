---
id: server-short-circuit-config
kind: type
category: Types
title: ShortCircuitConfig
symbol: "@supabase/server.ShortCircuitConfig"
summary: "The option shared by every middleware that answers a request itself: `withSupabase`, `withClaims`, `withRequiredClaims`, `withPostgresClient`, `withPostgresAdminClient` and `withOAuthProtectedResource`. Each applies `errors` to its own responses."
description: |-
  The option shared by every middleware that answers a request itself:
  `withSupabase`, `withClaims`, `withRequiredClaims`, `withPostgresClient`,
  `withPostgresAdminClient` and `withOAuthProtectedResource`. Each applies
  `errors` to its own responses.
signature: interface ShortCircuitConfig
stability: stable
deprecated: false
properties:
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
