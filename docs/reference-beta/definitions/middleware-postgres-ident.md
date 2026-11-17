---
id: middleware-postgres-ident
kind: method
category: Middleware
title: ident
symbol: "@supabase/server/middleware/postgres.ident"
summary: Quote a Postgres identifier — a table, column, or role name — for safe interpolation into SQL text.
description: |-
  Quote a Postgres identifier — a table, column, or role name — for safe
  interpolation into SQL text.

  Bind parameters cover *values* and nothing else: `order by $1` sorts every
  row by the constant string `$1`, and `select $1 from t` selects a literal,
  not a column. Identifiers therefore have to reach the server as SQL text,
  which is the one place string-building is unavoidable. This makes that step
  safe by quoting the name and doubling any embedded quote, so the result is
  always exactly one identifier no matter what it contains.

  **It is not an allowlist.** Quoting a caller-supplied name yields a valid
  identifier, not a permitted one — `ident(req.query.sort)` cannot inject SQL
  but can still read a column the caller was never meant to see. Check the
  name against a fixed set you control first, then quote it.
signature: "ident(name: string): string"
stability: stable
deprecated: false
parameters:
  - name: name
    location: argument
    type: string
    required: true
    description: The identifier to quote.
returns:
  type: string
  description: The name wrapped in double quotes, with embedded quotes doubled.
throws:
  - description: |-
      If `name` is empty or contains a NUL byte — neither can survive the
      round trip, and Postgres reports both with errors that do not name the cause.
examples:
  - id: example-1
    title: Example 1
    lang: ts
    code: |
      const SORTABLE = new Set(['created_at', 'title'])
      if (!SORTABLE.has(column)) throw new Error('unsupported sort column')
      const rows = await ctx.postgres.queryRaw(
        `select id, title from posts order by ${ident(column)} desc`,
      )
---
