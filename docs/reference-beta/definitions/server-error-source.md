---
id: server-error-source
kind: constant
category: Errors
title: ErrorSource
symbol: "@supabase/server.ErrorSource"
summary: Package identifier stamped on every error this library produces.
description: |-
  Package identifier stamped on every error this library produces.

  Present as `source` on each error instance, as the `source` field of the JSON
  body `withSupabase` returns, and as a `[@supabase/server]` prefix on
  every `message` — so an error is traceable back here from a log line, a
  response body, or a response header alone.
signature: 'const ErrorSource: "@supabase/server"'
stability: stable
deprecated: false
examples: []
---
