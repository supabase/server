---
id: middleware-claims-with-claims-config
kind: type
category: Middleware
title: WithClaimsConfig
symbol: "@supabase/server/middleware/claims.WithClaimsConfig"
summary: Configuration for `withClaims`.
description: Configuration for `withClaims`.
signature: interface WithClaimsConfig extends ShortCircuitConfig
stability: stable
deprecated: false
properties:
  - name: jwks
    location: property
    type: JSONWebKeySet | URL
    required: false
    description: |-
      JWKS source used to verify tokens: an inline key set or a remote JWKS
      URL. Defaults to `SUPABASE_JWKS` (inline JSON) or `SUPABASE_JWKS_URL`
      (https endpoint) from the environment.
  - name: audience
    location: property
    type: string | string[]
    required: false
    description: |-
      Accepted `aud` claim value(s). When set, a token without `aud` is rejected,
      and a token whose `aud` is an array passes when any entry is accepted.
  - name: issuer
    location: property
    type: string | string[]
    required: false
    description: |-
      Accepted `iss` claim value(s). When set, a token without `iss` is rejected.
      Supabase Auth issues `https://<project-ref>.supabase.co/auth/v1`, which
      `fromSupabaseUrl(url)` builds from a project URL.
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
