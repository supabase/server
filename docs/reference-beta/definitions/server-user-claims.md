---
id: server-user-claims
kind: type
category: Types
title: UserClaims
symbol: "@supabase/server.UserClaims"
summary: Normalized, camelCase view of the authenticated user's identity.
description: |-
  Normalized, camelCase view of the authenticated user's identity.

  Derived from `JWTClaims`. For the full Supabase `User` object
  (including email confirmation status, providers, etc.), call
  `supabase.auth.getUser()` using the context client.
signature: interface UserClaims
stability: stable
deprecated: false
properties:
  - name: id
    location: property
    type: string
    required: true
    description: User's unique ID (same as `JWTClaims.sub`).
  - name: role
    location: property
    type: string
    required: false
    description: Supabase role (e.g. `"authenticated"`).
  - name: email
    location: property
    type: string
    required: false
    description: User's email address.
  - name: appMetadata
    location: property
    type: Record<string, unknown>
    required: false
    description: Application-level metadata (e.g. roles, permissions).
  - name: userMetadata
    location: property
    type: Record<string, unknown>
    required: false
    description: User-editable profile metadata (e.g. display name, avatar).
examples: []
---
