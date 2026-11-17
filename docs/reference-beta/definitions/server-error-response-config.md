---
id: server-error-response-config
kind: type
category: Types
title: ErrorResponseConfig
symbol: "@supabase/server.ErrorResponseConfig"
summary: "Controls how much of an error goes in the response body. Accepted as `errors` by `withSupabase` and by every middleware that answers a request directly: `withClaims`, `withRequiredClaims`, `withPostgresClient`, `withPostgresAdminClient` and `withOAuthProtectedResource`."
description: |-
  Controls how much of an error goes in the response body. Accepted as
  `errors` by `withSupabase` and by every middleware that answers a
  request directly: `withClaims`, `withRequiredClaims`, `withPostgresClient`,
  `withPostgresAdminClient` and `withOAuthProtectedResource`.
signature: interface ErrorResponseConfig
stability: stable
deprecated: false
properties:
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
examples:
  - id: trimming-the-response
    title: Trimming the response
    lang: ts
    code: |
      // Full payload: source, code, message, hint, docs, details
      withSupabase({ auth: 'user' }, handler)

      // Trimmed: code and message only
      withSupabase({ auth: 'user', errors: { detailed: false } }, handler)
---
