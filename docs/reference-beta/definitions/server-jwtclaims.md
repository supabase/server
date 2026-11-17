---
id: server-jwtclaims
kind: type
category: Types
title: JWTClaims
symbol: "@supabase/server.JWTClaims"
summary: Standard JWT claims as defined by RFC 7519, extended with Supabase-specific fields.
description: |-
  Standard JWT claims as defined by RFC 7519, extended with Supabase-specific fields.

  This is the raw JWT payload — use `UserClaims` for a normalized, camelCase view.
signature: interface JWTClaims
stability: stable
deprecated: false
properties:
  - name: sub
    location: property
    type: string
    required: true
    description: Subject — the user's unique ID.
  - name: iss
    location: property
    type: string
    required: false
    description: Issuer — typically your Supabase project URL.
  - name: aud
    location: property
    type: string | string[]
    required: false
    description: Audience — who the token is intended for.
  - name: exp
    location: property
    type: number
    required: false
    description: Expiration time (seconds since epoch).
  - name: iat
    location: property
    type: number
    required: false
    description: Issued at (seconds since epoch).
  - name: role
    location: property
    type: string
    required: false
    description: Supabase role (e.g. `"authenticated"`, `"anon"`).
  - name: email
    location: property
    type: string
    required: false
    description: User's email address from Supabase Auth.
  - name: app_metadata
    location: property
    type: Record<string, unknown>
    required: false
    description: Application-level metadata set via Supabase Auth admin APIs.
  - name: user_metadata
    location: property
    type: Record<string, unknown>
    required: false
    description: User-editable metadata set via Supabase Auth.
examples: []
---
