---
id: server-api-key-format
kind: type
category: Errors
title: ApiKeyFormat
symbol: "@supabase/server.ApiKeyFormat"
summary: How an `apikey` header value was classified by its public prefix. Used in diagnostics so a format mismatch can be reported without echoing the key.
description: |-
  How an `apikey` header value was classified by its public prefix. Used in
  diagnostics so a format mismatch can be reported without echoing the key.
signature: type ApiKeyFormat = "absent" | "publishable" | "secret" | "legacy-jwt" | "unrecognized"
stability: stable
deprecated: false
examples: []
---
