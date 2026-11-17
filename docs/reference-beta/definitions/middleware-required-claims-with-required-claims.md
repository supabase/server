---
id: middleware-required-claims-with-required-claims
kind: method
category: Middleware
title: withRequiredClaims
symbol: "@supabase/server/middleware/required-claims.withRequiredClaims"
summary: "The user-mode auth gate: requires a valid user JWT and contributes **non-null** `ctx.jwtClaims`. Verification runs against the project JWKS, the same core `withSupabase` uses for its `user` auth mode."
description: |-
  The user-mode auth gate: requires a valid user JWT and
  contributes **non-null** `ctx.jwtClaims`. Verification runs against the
  project JWKS, the same core `withSupabase` uses for its `user` auth mode.

  This is the required-caller counterpart to `withClaims`, which contributes
  claims when a token is present and lets token-less requests proceed as
  anonymous. A pipeline picks one or the other, "claims required" or "claims
  if present"; composing both is a compile-time conflict on the `jwtClaims`
  key.

  Behavior — every short-circuit uses the standard error payload, with the same
  code `withSupabase({ auth: 'user' })` returns for an identical request:
  - No `Authorization: Bearer` token → 401 `MISSING_CREDENTIALS`. The handler
    never runs.
  - An `sb_*` API key in that position → 401 `UNUSABLE_CREDENTIAL`: a
    credential arrived, just not a user JWT.
  - Token present but invalid → 401 `INVALID_JWT`, naming the specific reason.
  - Token present but no JWKS configured → 500 `JWKS_NOT_CONFIGURED`;
    verification is not optional and there is no decode-only mode.

  Because the contribution is non-null, gated handlers read `ctx.jwtClaims`
  directly, with no `?.sub ?? 'anon'` fallbacks. Downstream entries declaring
  a `jwtClaims` prerequisite, such as `withPostgresClient`, compose with no
  further verification.

  The 401 and 500 short-circuits carry no CORS headers, and a bare pipeline
  answers no `OPTIONS` preflight. For browser callers, compose `withCors`
  (`@supabase/middleware/cors`) ahead of the gate: it answers preflight before
  the gate runs and stamps `Access-Control-*` headers on the short-circuit
  responses.

  After `withSupabase` in a pipeline the context already carries verified
  `jwtClaims`, so this gate is unnecessary there and placing it after
  `withSupabase` is a compile-time conflict. Use `withSupabase({ auth: 'user' })`
  to gate that path.
signature: "withRequiredClaims(config?: WithRequiredClaimsConfig): Entry<{ jwtClaims: JWTClaims }>"
stability: stable
deprecated: false
parameters:
  - name: config
    location: argument
    type: WithRequiredClaimsConfig
    required: false
    description: ""
    children:
      - name: jwks
        location: argument
        type: JSONWebKeySet | URL
        required: false
        description: |-
          JWKS source used to verify tokens: an inline key set or a remote JWKS
          URL. Defaults to `SUPABASE_JWKS` (inline JSON) or `SUPABASE_JWKS_URL`
          (https endpoint) from the environment.
      - name: audience
        location: argument
        type: string | string[]
        required: false
        description: |-
          Accepted `aud` claim value(s). When set, a token without `aud` is rejected,
          and a token whose `aud` is an array passes when any entry is accepted.
      - name: issuer
        location: argument
        type: string | string[]
        required: false
        description: |-
          Accepted `iss` claim value(s). When set, a token without `iss` is rejected.
          Supabase Auth issues `https://<project-ref>.supabase.co/auth/v1`, which
          `fromSupabaseUrl(url)` builds from a project URL.
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
  type: "Entry<{ jwtClaims: JWTClaims }>"
  description: ""
throws: []
examples:
  - id: gated-standalone-pipeline
    title: Gated standalone pipeline
    lang: ts
    code: |
      import { pipeline } from '@supabase/middleware'
      import { withRequiredClaims } from '@supabase/server/middleware/required-claims'
      import { withPostgresClient } from '@supabase/server/middleware/postgres'

      export default {
        fetch: pipeline([withRequiredClaims(), withPostgresClient()], async (req, ctx) => {
          const rows = await ctx.postgres.query`select id, title from posts`
          return Response.json({ rows, caller: ctx.jwtClaims.sub })
        }),
      }
---
