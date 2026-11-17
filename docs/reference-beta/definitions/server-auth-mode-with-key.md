---
id: server-auth-mode-with-key
kind: type
category: Types
title: AuthModeWithKey
symbol: "@supabase/server.AuthModeWithKey"
summary: Extended auth mode that supports targeting a specific named key.
description: |-
  Extended auth mode that supports targeting a specific named key.

  Use the colon syntax (`"publishable:web_app"`) to require a specific named key
  from the `SUPABASE_PUBLISHABLE_KEYS` or `SUPABASE_SECRET_KEYS` JSON object.
  Use `"publishable:*"` or `"secret:*"` to accept any key in the set. The bare
  form without a colon (`"publishable"` / `"secret"`) matches only the `default` key.
signature: type AuthModeWithKey = AuthMode | `publishable:${string}` | `secret:${string}`
stability: stable
deprecated: false
examples:
  - id: named-key
    title: Named key
    lang: ts
    code: |
      // Accept only the "mobile" publishable key
      withSupabase({ auth: 'publishable:mobile' }, handler)

      // Accept any secret key
      withSupabase({ auth: 'secret:*' }, handler)

      // Mix named keys with other modes
      withSupabase({ auth: ['user', 'publishable:web_app'] }, handler)
---
