---
id: server-invalid-credentials-error
kind: constant
category: Errors
title: InvalidCredentialsError
symbol: "@supabase/server.InvalidCredentialsError"
summary: Generic credential failure. Retained as the fallback code for cases that don't match a more specific one.
description: |-
  Generic credential failure. Retained as the fallback code for cases that
  don't match a more specific one.
signature: 'const InvalidCredentialsError: "INVALID_CREDENTIALS"'
stability: stable
deprecated: false
examples: []
---

Prior to v1.5 this was the only code `withSupabase` ever
returned for a failed request. Prefer matching on the specific codes —
`MissingCredentialsError`, `InvalidApiKeyError`,
`InvalidJwtError` — which now cover nearly every real failure.
