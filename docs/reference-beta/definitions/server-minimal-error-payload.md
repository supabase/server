---
id: server-minimal-error-payload
kind: type
category: Errors
title: MinimalErrorPayload
symbol: "@supabase/server.MinimalErrorPayload"
summary: "Reduced error body produced when `errors: { detailed: false }` is set."
description: |-
  Reduced error body produced when `errors: { detailed: false }` is set.

  `message` keeps its `[@supabase/server]` prefix, so the error is still
  traceable back here even without the `source` field.
signature: type MinimalErrorPayload = Pick<ErrorPayload, "code" | "message">
stability: stable
deprecated: false
examples: []
---
