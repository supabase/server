---
id: server-oauth-protected-resource-config
kind: type
category: Types
title: OAuthProtectedResourceConfig
symbol: "@supabase/server.OAuthProtectedResourceConfig"
summary: Configuration for `withOAuthProtectedResource`.
description: |-
  Configuration for `withOAuthProtectedResource`.

  Both options accept a fixed string or a function of the request. Both default
  to values derived from the request as it arrives through the Supabase Edge
  Functions proxy, so no configuration is needed there.
signature: interface OAuthProtectedResourceConfig extends ShortCircuitConfig
stability: stable
deprecated: false
properties:
  - name: resourceServer
    location: property
    type: UrlOption
    required: false
    description: |-
      The resource identifier to advertise — this endpoint's externally-visible
      URL, which RFC 9728 §3.3 requires to equal the URL the client called.

      Defaults to the Edge Functions derivation. Required on any other backend,
      usually from the request — `(req) => new URL(req.url).origin + '/api/mcp'`.
      Unset there, every request other than the metadata route's `OPTIONS`
      preflight is answered with a `500` and code `MISSING_RESOURCE_SERVER`.
  - name: authorizationServer
    location: property
    type: UrlOption
    required: false
    description: |-
      The OAuth 2.1 authorization server to advertise, as an issuer identifier.

      Defaults to the project's Supabase Auth on Edge Functions. Elsewhere it
      falls back to `SUPABASE_PUBLIC_URL`, then `SUPABASE_URL`, each with
      `/auth/v1` appended; with neither set, the metadata route is answered with
      a `500` and code `MISSING_AUTHORIZATION_SERVER`. Pass
      `fromSupabaseUrl` for a specific project, or any other issuer
      directly.
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
