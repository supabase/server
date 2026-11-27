---
id: core-verify-auth-options
kind: type
category: Primitives
title: VerifyAuthOptions
symbol: "@supabase/server/core.VerifyAuthOptions"
summary: Options for `verifyAuth`.
description: Options for `verifyAuth`.
signature: interface VerifyAuthOptions
stability: stable
deprecated: false
properties:
  - name: auth
    location: property
    type: AuthModeWithKey | AuthModeWithKey[]
    required: false
    description: |-
      Auth mode(s) to try. Modes are attempted in order — the first match wins.

      Default: `"user"`
  - name: allow
    location: property
    type: AuthModeWithKey | AuthModeWithKey[]
    required: false
    description: |-
      Deprecated. Use `auth` instead. Kept for backward
      compatibility; will be removed in a future major release. When both are
      provided, `auth` wins.
  - name: audience
    location: property
    type: string | string[]
    required: false
    description: |-
      Accepted `aud` claim value(s) for `user` mode. When set, a token without
      `aud` is rejected, and a token whose `aud` is an array passes when any
      entry is accepted.
  - name: issuer
    location: property
    type: string | string[]
    required: false
    description: |-
      Accepted `iss` claim value(s) for `user` mode. When set, a token without
      `iss` is rejected. Supabase Auth issues `https://<project-ref>.supabase.co/auth/v1`,
      which `fromSupabaseUrl(url)` builds from a project URL.
  - name: env
    location: property
    type: Partial<SupabaseEnv>
    required: false
    description: Optional environment overrides (passed through to `resolveEnv`).
examples: []
---
