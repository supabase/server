---
id: server-postgres-pool-busy-error
kind: constant
category: Errors
title: PostgresPoolBusyError
symbol: "@supabase/server.PostgresPoolBusyError"
summary: Every pooled connection stayed busy for the whole checkout wait, so the query could not get one. `details.max` is the pool size and `details.waitedMs` the wait.
description: |-
  Every pooled connection stayed busy for the whole checkout wait, so the
  query could not get one. `details.max` is the pool size and
  `details.waitedMs` the wait.
signature: 'const PostgresPoolBusyError: "POSTGRES_POOL_BUSY"'
stability: stable
deprecated: false
examples: []
---
