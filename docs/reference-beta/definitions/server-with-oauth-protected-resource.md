---
id: server-with-oauth-protected-resource
kind: method
category: Middleware
title: withOAuthProtectedResource
symbol: "@supabase/server.withOAuthProtectedResource"
summary: Wraps a request handler with OAuth 2.1 Protected Resource behavior (RFC 9728).
description: |-
  Wraps a request handler with OAuth 2.1 Protected Resource
  behavior (RFC 9728).

  - Serves OAuth Protected Resource Metadata at `GET {resource}/oauth-protected-resource`
    (with permissive CORS, including the `OPTIONS` preflight, so browser-based clients can read it)
  - Enriches a `401` from the inner handler with `WWW-Authenticate: Bearer resource_metadata="..."`,
    unless the handler already set a `WWW-Authenticate` header (its value wins)
  - Passes any other path through to the inner handler unchanged (composition,
    not routing, decides what happens to it)
  - Answers a default URL it cannot derive with the JSON error response
    `withSupabase` returns for its own configuration failures (`500`,
    `x-supabase-server-error`); a throw from a configured `resourceServer` or
    `authorizationServer` function is the caller's and propagates

  The metadata route is matched on the path *suffix*, so **any** `GET` or
  `OPTIONS` ending in `/oauth-protected-resource` is answered here and never
  reaches the inner handler, at any depth. Other methods pass through.

  Zero-config on Supabase Edge Functions. Elsewhere
  `resourceServer` is required and
  `authorizationServer` falls back to
  `SUPABASE_URL`; one that cannot be resolved is reported as
  `MISSING_RESOURCE_SERVER` / `MISSING_AUTHORIZATION_SERVER`.

  Contributes `ctx.oauthProtectedResource` (the resolved metadata URL) to the
  downstream context. Nested under `withSupabase`, the key is typed on the
  handler's `ctx` when the outermost call is anchored with
  `satisfies FetchHandler` — see `withSupabase`'s type note. Placed directly
  after `withSupabase` with an auth mode that requires credentials, the
  composition is refused when the stack is built, since the gate would
  answer discovery and preflight before this middleware runs.
signature: "withOAuthProtectedResource(config?: OAuthProtectedResourceConfig): Entry<{ oauthProtectedResource: OAuthProtectedResourceContribution }>"
stability: stable
deprecated: false
parameters:
  - name: config
    location: argument
    type: OAuthProtectedResourceConfig
    required: false
    description: ""
    children:
      - name: resourceServer
        location: argument
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
        location: argument
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
  type: "Entry<{ oauthProtectedResource: OAuthProtectedResourceContribution }>"
  description: ""
throws: []
examples:
  - id: supabase-edge-functions-zero-config
    title: Supabase Edge Functions — zero config
    lang: ts
    code: |
      import { withOAuthProtectedResource, withSupabase } from '@supabase/server'

      Deno.serve(
        withOAuthProtectedResource(
          withSupabase({ auth: 'user' }, async (_req, { supabase }) => {
            const { data, error } = await supabase.from('items').select('*')
            if (error) throw error
            return Response.json(data)
          }),
        ),
      )
  - id: any-other-backend
    title: Any other backend
    lang: ts
    code: |
      import { withOAuthProtectedResource, fromSupabaseUrl } from '@supabase/server'

      export default {
        fetch: withOAuthProtectedResource(
          {
            resourceServer: (req) => new URL(req.url).origin + '/api/mcp',
            authorizationServer: fromSupabaseUrl('https://abc123.supabase.co'),
          },
          handler,
        ),
      }
  - id: a-non-supabase-authorization-server
    title: A non-Supabase authorization server
    lang: ts
    code: |
      withOAuthProtectedResource(
        {
          resourceServer: 'https://api.example.com/mcp',
          authorizationServer: 'https://example.clerk.accounts.dev',
        },
        handler,
      )
---
