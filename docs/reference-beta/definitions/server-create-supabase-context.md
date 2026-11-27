---
id: server-create-supabase-context
kind: method
category: Middleware
title: createSupabaseContext
symbol: "@supabase/server.createSupabaseContext"
summary: Creates a `SupabaseContext` directly from a request.
description: |-
  Creates a `SupabaseContext` directly from a request.

  Use this when you need the context without the full `withSupabase` wrapper —
  e.g., inside framework route handlers or custom middleware. Returns a result tuple
  instead of producing a `Response`.
signature: "createSupabaseContext<Database>(request: Request, options?: WithSupabaseConfig): Promise<{ data: SupabaseContext<Database>; error: null } | { data: null; error: AuthError }>"
stability: stable
deprecated: false
parameters:
  - name: request
    location: argument
    type: Request
    required: true
    description: The incoming HTTP request.
  - name: options
    location: argument
    type: WithSupabaseConfig
    required: false
    description: Auth modes, environment overrides. The `cors` option is ignored here.
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
returns:
  type: "Promise<{ data: SupabaseContext<Database>; error: null } | { data: null; error: AuthError }>"
  description: "`{ data: SupabaseContext, error: null }` on success, `{ data: null, error: AuthError }` on failure."
throws: []
examples:
  - id: user-auth
    title: User auth
    lang: ts
    code: |
      const { data: ctx, error } = await createSupabaseContext(request, { auth: 'user' })
      if (error) {
        // `toJSON()` yields { source, code, message, hint, docs, details }
        return Response.json(error.toJSON(), { status: error.status })
      }
      const { data } = await ctx.supabase.rpc('get_my_items')
---
