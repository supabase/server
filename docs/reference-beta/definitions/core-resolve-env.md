---
id: core-resolve-env
kind: method
category: Primitives
title: resolveEnv
symbol: "@supabase/server/core.resolveEnv"
summary: Resolves Supabase environment configuration from runtime environment variables.
description: |-
  Resolves Supabase environment configuration from runtime environment variables.

  Reads `SUPABASE_URL`, keys (`SUPABASE_PUBLISHABLE_KEYS` / `SUPABASE_SECRET_KEYS`),
  and the JWKS source (`SUPABASE_JWKS` for inline keys, `SUPABASE_JWKS_URL`
  for a remote endpoint, or the well-known endpoint derived from
  `SUPABASE_PUBLIC_URL` / the resolved `url`). Works across Deno, Node.js,
  and Bun. For Cloudflare Workers, use `overrides` or enable node-compat.
signature: "resolveEnv(overrides?: Partial<SupabaseEnv>): { data: SupabaseEnv; error: null } | { data: null; error: EnvError }"
stability: stable
deprecated: false
parameters:
  - name: overrides
    location: argument
    type: Partial<SupabaseEnv>
    required: false
    description: Partial values that take precedence over env vars.
returns:
  type: "{ data: SupabaseEnv; error: null } | { data: null; error: EnvError }"
  description: "`{ data: SupabaseEnv, error: null }` on success, `{ data: null, error: EnvError }` on failure."
throws: []
examples:
  - id: reading-and-overriding-env-vars
    title: Reading and overriding env vars
    lang: ts
    code: |
      const { data: env, error } = resolveEnv()
      if (error) throw error

      // Override for tests
      const { data: env } = resolveEnv({ url: 'http://localhost:54321' })
---
