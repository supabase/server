---
id: middleware-claims-with-claims
kind: method
category: Middleware
title: withClaims
symbol: "@supabase/server/middleware/claims.withClaims"
summary: Contributes `ctx.jwtClaims` by verifying the caller's Bearer token against the project JWKS — the same verification core `withSupabase` uses for its `user` auth mode.
description: |-
  Contributes `ctx.jwtClaims` by verifying the caller's Bearer
  token against the project JWKS — the same verification core `withSupabase`
  uses for its `user` auth mode.

  Use this when composing a standalone `pipeline([...], handler)` that is
  **not** wrapped by `withSupabase` — for example a Supabase-agnostic Edge
  Function that still wants the caller's verified claims available to a
  downstream middleware such as `withPostgresClient`. Inside `withSupabase`, the
  context already carries `jwtClaims`, so `withClaims` is unnecessary.

  Behavior:
  - No `Authorization: Bearer` token (or an `sb_*` API key in that position)
    → contributes `null`; the request proceeds as anonymous.
  - Token present but invalid → short-circuits with a 401 JSON response
    (`{ message, code }`, matching `withSupabase`'s error shape).
  - Token present but no JWKS configured → short-circuits with a 500 —
    verification is not optional; there is no decode-only mode.

  `withClaims` is not an auth gate. It never rejects a request that has no
  token. A pipeline like `[withClaims(), withSupabaseClient()]` accepts
  anonymous callers and is not the composable form of
  `withSupabase({ auth: 'user' })`, which rejects token-less requests with
  a 401. To require an authenticated caller, compose `withRequiredClaims`
  from `@supabase/server/middleware/required-claims` instead. The two entries
  share the `jwtClaims` key, so a pipeline picks "claims if present" or
  "claims required"; composing both is a compile-time conflict.
signature: "withClaims(config?: WithClaimsConfig): Entry<{ jwtClaims: JWTClaims | null }>"
stability: stable
deprecated: false
parameters:
  - name: config
    location: argument
    type: WithClaimsConfig
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
  type: "Entry<{ jwtClaims: JWTClaims | null }>"
  description: ""
throws: []
examples:
  - id: standalone-pipeline
    title: Standalone pipeline
    lang: ts
    code: |
      import { pipeline } from '@supabase/middleware'
      import { withClaims } from '@supabase/server/middleware/claims'
      import { withPostgresClient } from '@supabase/server/middleware/postgres'

      export default {
        fetch: pipeline([withClaims(), withPostgresClient()], async (req, ctx) => {
          const rows = await ctx.postgres.query`select id, title from posts`
          return Response.json({ rows, caller: ctx.jwtClaims?.sub ?? 'anon' })
        }),
      }
---
