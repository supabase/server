---
id: server-auth-config
kind: type
category: Types
title: AuthConfig
symbol: "@supabase/server.AuthConfig"
summary: "Accepted shape of the `auth` option: one mode, or an ordered list of modes tried left to right."
description: |-
  Accepted shape of the `auth` option: one mode, or an ordered list of modes
  tried left to right.

  `"none"` accepts every request, so it only carries meaning as the last
  entry of a list — the modes before it are the ones that can produce an
  identity, and anything after it is unreachable. On its own in a list
  (`["none"]`) it says nothing that a bare `auth: 'none'` doesn't. So the
  type accepts `"none"` alone or in final position behind at least one
  credentialed mode, and nowhere else.

  A single mode needs no wrapping array — `"user"` and `["user"]` are the
  same configuration, and the unwrapped form is the one the union names
  first, so it is what shows up in editor completions.
signature: type AuthConfig = "none" | CredentialedAuthMode | [CredentialedAuthMode, ...CredentialedAuthMode[]] | [CredentialedAuthMode, ...CredentialedAuthMode[], "none"]
stability: stable
deprecated: false
examples:
  - id: every-accepted-form
    title: Every accepted form
    lang: ts
    code: |
      withSupabase({ auth: 'user' }, handler)              // one mode
      withSupabase({ auth: ['secret', 'user'] }, handler)  // first match wins
      withSupabase({ auth: ['user', 'none'] }, handler)    // optional user
      withSupabase({ auth: 'none' }, handler)              // no credentials required
---
