---
id: server-unusable-credential-error
kind: constant
category: Errors
title: UnusableCredentialError
symbol: "@supabase/server.UnusableCredentialError"
summary: A credential *did* arrive, but not one any accepted auth mode can use — an `sb_*` API key in the `Authorization` header, or a header this library cannot read a bearer token out of (wrong scheme, wrong casing, bare value, empty token).
description: |-
  A credential *did* arrive, but not one any accepted auth mode can use — an
  `sb_*` API key in the `Authorization` header, or a header this library cannot
  read a bearer token out of (wrong scheme, wrong casing, bare value, empty
  token).
signature: 'const UnusableCredentialError: "UNUSABLE_CREDENTIAL"'
stability: stable
deprecated: false
examples: []
---

Distinct from `MissingCredentialsError` on purpose. The two
partition the "nothing authenticated" space exactly — nothing arrived vs.
something arrived that could not be used — so the code stays true on its own
when `errors: { detailed: false }` strips `hint` and `details`.
