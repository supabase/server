---
id: server-auth-result
kind: type
category: Types
title: AuthResult
symbol: "@supabase/server.AuthResult"
summary: Result of credential verification.
description: |-
  Result of credential verification.

  Contains the resolved auth mode, the verified token (for `"user"` mode),
  decoded JWT claims, and the matched key name (for `"publishable"` / `"secret"` modes).
signature: interface AuthResult
stability: stable
deprecated: false
properties:
  - name: authMode
    location: property
    type: AuthMode
    required: true
    description: The auth mode that was successfully matched.
  - name: token
    location: property
    type: string | null
    required: true
    description: The verified JWT, or `null` for non-user auth modes.
  - name: userClaims
    location: property
    type: UserClaims | null
    required: true
    description: Normalized user identity derived from the JWT, or `null` when no JWT is present.
  - name: jwtClaims
    location: property
    type: JWTClaims | null
    required: true
    description: Raw JWT payload, or `null` when no JWT is present.
  - name: keyName
    location: property
    type: string | null
    required: false
    description: Name of the matched key (e.g. `"default"`, `"mobile"`), or `null` for `"user"` / `"none"` modes.
examples: []
---
