---
id: core-verify-credentials
kind: method
category: Primitives
title: verifyCredentials
symbol: "@supabase/server/core.verifyCredentials"
summary: Verifies pre-extracted credentials against one or more allowed auth modes.
description: |-
  Verifies pre-extracted credentials against one or more allowed auth modes.

  Tries each mode in order — first match wins. A mode is only tried when its
  credential is present; a JWT that is present but fails verification
  short-circuits the chain with `InvalidJwtError` instead of falling
  through to the next mode. Use `verifyAuth` to extract and verify in a
  single call.

  When every mode falls through, the returned error names the actual cause
  rather than a generic failure — `MissingCredentialsError` when the
  request carried nothing, `InvalidApiKeyError` when an `apikey` matched
  no configured key, or a `500` (`JwksNotConfiguredError`,
  `NoKeysConfiguredError`) when the server is configured such that no
  request could ever have succeeded. Every error carries `hint`, `docs`, and
  non-sensitive `details`.

  A misconfiguration `500` is only reported once nothing has matched, so an
  allowed mode that does match the request's credentials still wins — e.g.
  `['user', 'secret']` with no JWKS but a valid apikey authenticates as
  `secret`. `sb_*` values in the Authorization slot are API keys, not user
  tokens, and stay a caller error.
signature: "verifyCredentials(credentials: Credentials, options: VerifyCredentialsOptions): Promise<{ data: AuthResult; error: null } | { data: null; error: AuthError }>"
stability: stable
deprecated: false
parameters:
  - name: credentials
    location: argument
    type: Credentials
    required: true
    description: The credentials to verify (from `extractCredentials`).
    children:
      - name: token
        location: argument
        type: string | null
        required: true
        description: "Bearer token from the `Authorization: Bearer <token>` header, or `null` if absent."
      - name: apikey
        location: argument
        type: string | null
        required: true
        description: API key from the `apikey` header, or `null` if absent.
  - name: options
    location: argument
    type: VerifyCredentialsOptions
    required: true
    description: Allowed auth modes and optional env overrides.
    children:
      - name: auth
        location: argument
        type: AuthModeWithKey | AuthModeWithKey[]
        required: false
        description: |-
          Auth mode(s) to try. Modes are attempted in order — the first match wins.

          Default: `"user"`
      - name: allow
        location: argument
        type: AuthModeWithKey | AuthModeWithKey[]
        required: false
        description: |-
          Deprecated. Use `auth` instead. Kept for
          backward compatibility; will be removed in a future major release. When
          both are provided, `auth` wins.
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
        description: Optional environment overrides (passed through to `resolveEnv`).
returns:
  type: "Promise<{ data: AuthResult; error: null } | { data: null; error: AuthError }>"
  description: "`{ data: AuthResult, error: null }` on success, `{ data: null, error: AuthError }` on failure."
throws: []
examples:
  - id: multiple-auth-modes
    title: Multiple auth modes
    lang: ts
    code: |
      const credentials = extractCredentials(request)
      const { data: auth, error } = await verifyCredentials(credentials, {
        auth: ['user', 'publishable'],
      })
      if (error) {
        console.error(error.code, error.message, error.hint)
        return Response.json(error.toJSON(), { status: error.status })
      }
---
