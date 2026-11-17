---
id: server-supabase-context
kind: type
category: Types
title: SupabaseContext
symbol: "@supabase/server.SupabaseContext"
summary: The Supabase context created for each authenticated request.
description: |-
  The Supabase context created for each authenticated request.

  Contains pre-configured Supabase clients and the caller's identity.
  Identical regardless of which layer or adapter produced it.
signature: interface SupabaseContext<Database>
stability: stable
deprecated: false
properties:
  - name: supabase
    location: property
    type: SupabaseClient<Database>
    required: true
    description: Supabase client scoped to the caller's identity. RLS policies apply.
  - name: supabaseAdmin
    location: property
    type: SupabaseClient<Database>
    required: true
    description: Admin Supabase client that bypasses Row-Level Security.
  - name: userClaims
    location: property
    type: UserClaims | null
    required: true
    description: JWT-derived identity. For the full Supabase User object, call `supabase.auth.getUser()`.
  - name: jwtClaims
    location: property
    type: JWTClaims | null
    required: true
    description: Raw JWT payload. `null` for non-user auth modes.
  - name: authMode
    location: property
    type: AuthMode
    required: true
    description: The auth mode that was used for this request.
  - name: authKeyName
    location: property
    type: string
    required: false
    description: |-
      The auth key name of the API key that was used for this request.
      Omitted for `'user'` and `'none'` modes, which don't match a named key.
examples: []
---
