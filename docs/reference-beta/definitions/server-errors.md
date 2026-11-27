---
id: server-errors
kind: constant
category: Errors
title: Errors
symbol: "@supabase/server.Errors"
summary: Factory map for all error types. Keyed by error code constant, each entry returns a pre-configured `EnvError`, `AuthError`, or `PostgresPoolError` complete with `hint`, `docs`, and `details`.
description: |-
  Factory map for all error types. Keyed by error code constant, each entry
  returns a pre-configured `EnvError`, `AuthError`, or
  `PostgresPoolError` complete with `hint`, `docs`, and `details`.
signature: 'const Errors: { MISSING_SUPABASE_URL: () => EnvError; MISSING_SECRET_KEY: (name: string, availableKeyNames?: readonly string[]) => EnvError; MISSING_DEFAULT_SECRET_KEY: (availableKeyNames?: readonly string[]) => EnvError; MISSING_PUBLISHABLE_KEY: (name: string, availableKeyNames?: readonly string[]) => EnvError; MISSING_DEFAULT_PUBLISHABLE_KEY: (availableKeyNames?: readonly string[]) => EnvError; MISSING_RESOURCE_SERVER: (runtime: string) => EnvError; MISSING_AUTHORIZATION_SERVER: () => EnvError; MISSING_CONNECTION_STRING: (middleware: string) => EnvError; MISSING_CREDENTIALS: (context: AuthFailureContext) => AuthError; UNUSABLE_CREDENTIAL: (context: Partial<AuthFailureContext> & { reason: string; hint: string }) => AuthError; INVALID_API_KEY: (context: AuthFailureContext) => AuthError; INVALID_JWT: (context: Partial<AuthFailureContext> & { reason: string; hint: string; jwt?: Record<string, unknown>; cause?: unknown }) => AuthError; JWKS_NOT_CONFIGURED: (context: Partial<AuthFailureContext> & { middleware?: string }) => AuthError; JWKS_FETCH_FAILED: (context: Partial<AuthFailureContext> & { reason: string; cause?: unknown }) => AuthError; NO_KEYS_CONFIGURED: (context: AuthFailureContext & { mode: string; keyKind: "publishable" | "secret" }) => AuthError; INVALID_CREDENTIALS: (context?: AuthFailureContext) => AuthError; CREATE_SUPABASE_CLIENT_ERROR: (options?: { cause?: unknown }) => AuthError; UNSUPPORTED_ROLE: (context: { requestedRole: unknown; supportedRoles: readonly string[] }) => AuthError; POSTGRES_POOL_BUSY: (context: { max: number; waitedMs: number }) => PostgresPoolError; POSTGRES_CONNECT_PAUSED: (context: { remainingMs: number; cause: unknown }) => PostgresPoolError }'
stability: stable
deprecated: false
properties:
  - name: MISSING_SUPABASE_URL
    location: property
    type: () => EnvError
    required: true
    description: ""
  - name: MISSING_SECRET_KEY
    location: property
    type: "(name: string, availableKeyNames?: readonly string[]) => EnvError"
    required: true
    description: ""
  - name: MISSING_DEFAULT_SECRET_KEY
    location: property
    type: "(availableKeyNames?: readonly string[]) => EnvError"
    required: true
    description: ""
  - name: MISSING_PUBLISHABLE_KEY
    location: property
    type: "(name: string, availableKeyNames?: readonly string[]) => EnvError"
    required: true
    description: ""
  - name: MISSING_DEFAULT_PUBLISHABLE_KEY
    location: property
    type: "(availableKeyNames?: readonly string[]) => EnvError"
    required: true
    description: ""
  - name: MISSING_RESOURCE_SERVER
    location: property
    type: "(runtime: string) => EnvError"
    required: true
    description: ""
  - name: MISSING_AUTHORIZATION_SERVER
    location: property
    type: () => EnvError
    required: true
    description: ""
  - name: MISSING_CONNECTION_STRING
    location: property
    type: "(middleware: string) => EnvError"
    required: true
    description: ""
  - name: MISSING_CREDENTIALS
    location: property
    type: "(context: AuthFailureContext) => AuthError"
    required: true
    description: ""
  - name: UNUSABLE_CREDENTIAL
    location: property
    type: "(context: Partial<AuthFailureContext> & { reason: string; hint: string }) => AuthError"
    required: true
    description: ""
  - name: INVALID_API_KEY
    location: property
    type: "(context: AuthFailureContext) => AuthError"
    required: true
    description: ""
  - name: INVALID_JWT
    location: property
    type: "(context: Partial<AuthFailureContext> & { reason: string; hint: string; jwt?: Record<string, unknown>; cause?: unknown }) => AuthError"
    required: true
    description: ""
  - name: JWKS_NOT_CONFIGURED
    location: property
    type: "(context: Partial<AuthFailureContext> & { middleware?: string }) => AuthError"
    required: true
    description: ""
  - name: JWKS_FETCH_FAILED
    location: property
    type: "(context: Partial<AuthFailureContext> & { reason: string; cause?: unknown }) => AuthError"
    required: true
    description: ""
  - name: NO_KEYS_CONFIGURED
    location: property
    type: '(context: AuthFailureContext & { mode: string; keyKind: "publishable" | "secret" }) => AuthError'
    required: true
    description: ""
  - name: INVALID_CREDENTIALS
    location: property
    type: "(context?: AuthFailureContext) => AuthError"
    required: true
    description: ""
  - name: CREATE_SUPABASE_CLIENT_ERROR
    location: property
    type: "(options?: { cause?: unknown }) => AuthError"
    required: true
    description: ""
  - name: UNSUPPORTED_ROLE
    location: property
    type: "(context: { requestedRole: unknown; supportedRoles: readonly string[] }) => AuthError"
    required: true
    description: ""
  - name: POSTGRES_POOL_BUSY
    location: property
    type: "(context: { max: number; waitedMs: number }) => PostgresPoolError"
    required: true
    description: ""
  - name: POSTGRES_CONNECT_PAUSED
    location: property
    type: "(context: { remainingMs: number; cause: unknown }) => PostgresPoolError"
    required: true
    description: ""
examples:
  - id: throwing-typed-errors
    title: Throwing typed errors
    lang: ts
    code: |
      throw Errors[MissingSupabaseURLError]()
      throw Errors[MissingPublishableKeyError]('mobile', ['default', 'web'])
---
