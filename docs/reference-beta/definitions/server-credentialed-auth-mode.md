---
id: server-credentialed-auth-mode
kind: type
category: Types
title: CredentialedAuthMode
symbol: "@supabase/server.CredentialedAuthMode"
summary: An auth mode that requires a credential — every `AuthModeWithKey` except `"none"`, keyed forms included.
description: |-
  An auth mode that requires a credential — every `AuthModeWithKey`
  except `"none"`, keyed forms included.
signature: type CredentialedAuthMode = Exclude<AuthModeWithKey, "none">
stability: stable
deprecated: false
examples: []
---
