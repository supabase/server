---
id: server-invalid-jwt-error
kind: constant
category: Errors
title: InvalidJwtError
symbol: "@supabase/server.InvalidJwtError"
summary: A JWT was present in the `Authorization` header but failed verification. `details.jwt` and the message carry the specific reason (expired, bad signature, unknown `kid`, malformed token or claim, no `sub`, mismatched or missing `aud` / `iss`, `nbf` in the future).
description: |-
  A JWT was present in the `Authorization` header but failed verification.
  `details.jwt` and the message carry the specific reason (expired, bad
  signature, unknown `kid`, malformed token or claim, no `sub`, mismatched or
  missing `aud` / `iss`, `nbf` in the future).
signature: 'const InvalidJwtError: "INVALID_JWT"'
stability: stable
deprecated: false
examples: []
---
