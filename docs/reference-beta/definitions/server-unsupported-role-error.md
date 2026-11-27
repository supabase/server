---
id: server-unsupported-role-error
kind: constant
category: Errors
title: UnsupportedRoleError
symbol: "@supabase/server.UnsupportedRoleError"
summary: The caller's verified `role` claim names a Postgres role the middleware will not assume — either one that would bypass RLS, or one it does not support yet. Returned by `withPostgresClient` instead of silently running the query as `anon`.
description: |-
  The caller's verified `role` claim names a Postgres role the middleware
  will not assume — either one that would bypass RLS, or one it does not
  support yet. Returned by `withPostgresClient` instead of silently running
  the query as `anon`.
signature: 'const UnsupportedRoleError: "UNSUPPORTED_ROLE"'
stability: stable
deprecated: false
examples: []
---
