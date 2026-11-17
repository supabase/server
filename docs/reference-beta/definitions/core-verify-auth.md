---
id: core-verify-auth
kind: method
category: Primitives
title: verifyAuth
symbol: "@supabase/server/core.verifyAuth"
summary: Extracts credentials from a request and verifies them in a single step.
description: |-
  Extracts credentials from a request and verifies them in a single step.

  This is a convenience function that combines `extractCredentials` and
  `verifyCredentials`. Use it when you want the full auth flow without
  needing to inspect the raw credentials.
signature: "verifyAuth(request: Request, options: VerifyAuthOptions): Promise<{ data: AuthResult; error: null } | { data: null; error: AuthError }>"
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
    type: VerifyAuthOptions
    required: true
    description: Auth modes to accept and optional environment overrides.
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
          Deprecated. Use `auth` instead. Kept for backward
          compatibility; will be removed in a future major release. When both are
          provided, `auth` wins.
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
  description: |-
    A result tuple: `{ data, error }`.
      - On success: `{ data: AuthResult, error: null }`
      - On failure: `{ data: null, error: AuthError }`
throws: []
examples:
  - id: user-auth
    title: User auth
    lang: ts
    code: |
      import { verifyAuth } from '@supabase/server/core'

      const { data: auth, error } = await verifyAuth(request, {
        auth: 'user',
      })

      if (error) {
        return Response.json({ message: error.message }, { status: error.status })
      }

      console.log(auth.userClaims!.id) // "d0f1a2b3-..."
---
