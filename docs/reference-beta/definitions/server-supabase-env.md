---
id: server-supabase-env
kind: type
category: Types
title: SupabaseEnv
symbol: "@supabase/server.SupabaseEnv"
summary: Resolved Supabase environment configuration.
description: |-
  Resolved Supabase environment configuration.

  Holds the project URL, API keys, and JWKS needed by every other primitive.
  Typically resolved automatically from environment variables by `resolveEnv`,
  but can be passed explicitly via the `env` option.
signature: interface SupabaseEnv
stability: stable
deprecated: false
properties:
  - name: url
    location: property
    type: string
    required: true
    description: Supabase project URL (e.g. `"https://<ref>.supabase.co"`). Sourced from `SUPABASE_URL`.
  - name: publishableKeys
    location: property
    type: Record<string, string>
    required: true
    description: |-
      Named publishable keys. Sourced from `SUPABASE_PUBLISHABLE_KEYS` (JSON object)
      or `SUPABASE_PUBLISHABLE_KEY` (single key, stored as `{ default: "<value>" }`).
  - name: secretKeys
    location: property
    type: Record<string, string>
    required: true
    description: |-
      Named secret keys. Sourced from `SUPABASE_SECRET_KEYS` (JSON object)
      or `SUPABASE_SECRET_KEY` (single key, stored as `{ default: "<value>" }`).
  - name: jwks
    location: property
    type: JSONWebKeySet | URL | null
    required: true
    description: |-
      JWKS source used for JWT verification.

      Sourced from one of (in priority order):
      - `SUPABASE_JWKS` — inline JSON. Resolves to a `JSONWebKeySet`.
      - `SUPABASE_JWKS_URL` — remote endpoint. Resolves to a `URL`; keys
        are fetched lazily and cached in memory (cooldown / max-age handled by
        `jose`). `https://` is always accepted; plain `http://` is accepted
        only for loopback hosts (`localhost`, `127.0.0.0/8`, `::1`) to support
        the Supabase CLI. Any other `http://` URL is rejected to prevent MITM
        swap-in of a forged signing key.

      `null` when no JWKS is configured (JWT verification will be unavailable).
      Each env var is authoritative when set: a malformed value resolves to
      `null` rather than falling through to the other variable.
examples: []
---
