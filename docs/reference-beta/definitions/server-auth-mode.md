---
id: server-auth-mode
kind: type
category: Types
title: AuthMode
symbol: "@supabase/server.AuthMode"
summary: Authentication mode that determines what credentials a request must provide.
description: |-
  Authentication mode that determines what credentials a request must provide.

  - `"none"` — No credentials required. Every request is accepted.
  - `"publishable"` — Requires a valid publishable key in the `apikey` header. Matches only the `default` key.
  - `"secret"` — Requires a valid secret key in the `apikey` header (timing-safe comparison). Matches only the `default` key.
  - `"user"` — Requires a valid JWT in the `Authorization: Bearer <token>` header.

  Bare `"publishable"` / `"secret"` resolve the `default` key from
  `SUPABASE_PUBLISHABLE_KEYS` / `SUPABASE_SECRET_KEYS`. To target another key or
  accept any key, see `AuthModeWithKey`.
signature: type AuthMode = "none" | "publishable" | "secret" | "user"
stability: stable
deprecated: false
examples:
  - id: single-mode
    title: Single mode
    lang: ts
    code: |
      // Single mode
      withSupabase({ auth: 'user' }, handler)

      // Multiple modes — the first match wins.
      // A mode is tried only when its credential is present; a JWT that is
      // present but fails verification rejects immediately rather than falling
      // through to the next mode.
      withSupabase({ auth: ['user', 'publishable'] }, handler)
---
