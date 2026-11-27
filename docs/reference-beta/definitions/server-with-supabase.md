---
id: server-with-supabase
kind: method
category: Middleware
title: withSupabase
symbol: "@supabase/server.withSupabase"
summary: Wraps a request handler with Supabase auth, client creation, and CORS handling.
description: |-
  Wraps a request handler with Supabase auth, client creation, and CORS handling.

  Built for the Web API `Request`/`Response` standard that all modern runtimes
  implement natively. Handles CORS preflight, credential verification,
  context creation, and error responses. Your handler only runs on successful auth.
signature: "withSupabase<Database, Base>(config: WithSupabaseConfig, handler: (req: Request, ctx: NoInfer<Base> & SupabaseContext<Database>) => Promise<Response>): (req: Request, ctx?: Base) => Promise<Response>"
stability: stable
deprecated: false
parameters:
  - name: config
    location: argument
    type: WithSupabaseConfig
    required: true
    description: Auth modes, CORS, and environment overrides. See `WithSupabaseConfig`.
    children:
      - name: auth
        location: argument
        type: AuthConfig
        required: false
        description: |-
          Auth mode(s) to accept. Modes are tried in order — the first match wins.
          A mode falls through only when its credential is absent; a present-but-invalid
          JWT short-circuits the chain with `InvalidJwtError` (`INVALID_JWT`).

          `"none"` matches unconditionally, so it belongs last in a list or on its
          own — see `AuthConfig`.

          Default: `"user"`
      - name: allow
        location: argument
        type: AuthModeWithKey | AuthModeWithKey[]
        required: false
        description: |-
          Deprecated. Use `auth` instead. The `allow` option
          is kept for backward compatibility and will be removed in a future major release.
          When both `auth` and `allow` are provided, `auth` takes precedence. It keeps
          the older, looser element type so code mid-migration still compiles; `auth`
          is where the `AuthConfig` ordering rule is enforced.
      - name: audience
        location: argument
        type: string | string[]
        required: false
        description: |-
          Accepted `aud` claim value(s) for `user` mode. When set, a token without
          `aud` is rejected, and a token whose `aud` is an array passes when any
          entry is accepted.
      - name: issuer
        location: argument
        type: string | string[]
        required: false
        description: |-
          Accepted `iss` claim value(s) for `user` mode. When set, a token without
          `iss` is rejected. Supabase Auth issues `https://<project-ref>.supabase.co/auth/v1`,
          which `fromSupabaseUrl(url)` builds from a project URL.
      - name: env
        location: argument
        type: Partial<SupabaseEnv>
        required: false
        description: |-
          Override auto-detected environment variables. Useful for testing
          or when running in environments without standard env var support.
      - name: cors
        location: argument
        type: 'boolean | Record<string, string> | "default" | "disabled" | { headers: Record<string, string> }'
        required: false
        description: |-
          CORS configuration for the `withSupabase` wrapper.

          - `'default'` — uses `@supabase/supabase-js` default CORS headers.
          - `'disabled'` — disables CORS handling entirely.
          - `{ headers }` — custom CORS headers.

          The boolean (`true`/`false`) and bare `Record<string, string>` forms are
          deprecated but still accepted for backward compatibility.

          Default: `'default'`
      - name: supabaseOptions
        location: argument
        type: SupabaseClientOptions<string>
        required: false
        description: |-
          Options forwarded to both internal `createClient()` calls.

          `accessToken` is stripped, and auth settings (`persistSession`, `autoRefreshToken`,
          `detectSessionInUrl`) are force-overwritten to server-safe values.
      - name: errors
        location: argument
        type: ErrorResponseConfig
        required: false
        description: How much of an error to include in the response body.
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
  - name: handler
    location: argument
    type: "(req: Request, ctx: NoInfer<Base> & SupabaseContext<Database>) => Promise<Response>"
    required: true
    description: Receives the `Request` and a fully-initialized `SupabaseContext`.
returns:
  type: "(req: Request, ctx?: Base) => Promise<Response>"
  description: |-
    A fetch handler. The optional second parameter is the host's
    platform argument (a Workers `env`, a Deno `ServeHandlerInfo`) — when the
    runtime supplies one, it is captured as the platform env behind
    `@supabase/middleware`'s `getEnv` for any composed middleware. Nested under
    another middleware, it is that middleware's accumulated context instead,
    which is reused rather than reseeded. At the entry point the request body
    is buffered, so a nested middleware and the handler can both read it.

    **Type note.** `Base` carries an upstream middleware's contributions into the
    handler's `ctx`: with `satisfies FetchHandler` on the outermost call,
    `withOAuthProtectedResource(withSupabase(config, handler))` types
    `ctx.oauthProtectedResource` with no annotation. The anchor is the same one
    the engine already asks of nested stacks (it also gates collision detection
    there): `Base` flows from the contextual return type, and without the anchor
    the outer call resolves before it can push, so `Base` stays the empty
    upstream and upstream keys are absent from `ctx`. Supplying `Database` explicitly
    (`withSupabase<Db>(...)`) also defaults every later type parameter, `Base`
    included; in that case annotate both (`withSupabase<Db, UpstreamCtx>(...)`)
    or read the upstream key through a cast.
throws: []
examples:
  - id: basic-usage
    title: Basic usage
    lang: ts
    code: |
      import { withSupabase } from '@supabase/server'

      export default {
        fetch: withSupabase({ auth: 'user' }, async (req, ctx) => {
          const { data } = await ctx.supabase.rpc('get_my_profile')
          return Response.json(data)
        }),
      }
---
