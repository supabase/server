---
id: server-postgres-connect-paused-error
kind: constant
category: Errors
title: PostgresConnectPausedError
symbol: "@supabase/server.PostgresConnectPausedError"
summary: A connection attempt failed and the pool is pausing new attempts, so a query that needed a new connection was refused without trying. `cause` is the failure and `details.retryAfterMs` the time left in the pause.
description: |-
  A connection attempt failed and the pool is pausing new attempts, so a query
  that needed a new connection was refused without trying. `cause` is the
  failure and `details.retryAfterMs` the time left in the pause.
signature: 'const PostgresConnectPausedError: "POSTGRES_CONNECT_PAUSED"'
stability: stable
deprecated: false
examples: []
---
