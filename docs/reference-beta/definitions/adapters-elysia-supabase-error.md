---
id: adapters-elysia-supabase-error
kind: class
category: Adapters
title: SupabaseError
symbol: "@supabase/server/adapters/elysia.SupabaseError"
summary: Wraps an `AuthError` as an Elysia-compatible error.
description: |-
  Wraps an `AuthError` as an Elysia-compatible error.

  Discriminate in `onError` via `code === 'SupabaseError'`. The original
  `AuthError` is available as the typed `.cause`.
signature: class SupabaseError extends Error
stability: stable
deprecated: true
parameters:
  - name: inner
    location: argument
    type: AuthError
    required: true
    description: ""
properties:
  - name: status
    location: property
    type: number
    required: true
    description: ""
  - name: cause
    location: property
    type: AuthError
    required: true
    description: ""
examples: []
---

> **Deprecated:** Removed with the Elysia adapter on December 1, 2026. The Elysia
  bridge from the framework integration guide answers auth failures with
  a `Response` instead: https://supabase.com/docs/reference/server/frameworks
