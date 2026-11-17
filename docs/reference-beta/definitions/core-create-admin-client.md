---
id: core-create-admin-client
kind: method
category: Primitives
title: createAdminClient
symbol: "@supabase/server/core.createAdminClient"
summary: Creates an admin Supabase client that bypasses Row-Level Security.
description: |-
  Creates an admin Supabase client that bypasses Row-Level Security.

  Uses a secret key for authentication, giving full access to all data.
  Stateless — one client per request.

  ## Which key is used

  With `auth.keyName` set, that named key from `SUPABASE_SECRET_KEYS` is used —
  and it throws if the key doesn't exist. With `keyName` omitted, the `default`
  key is used, falling back to the first key in the set when no `default` exists.

  Note this differs from the `"secret"` auth mode, which matches the `default`
  key only and never falls back — see `AuthModeWithKey`.
signature: "createAdminClient<Database>(options?: CreateAdminClientOptions): SupabaseClient<Database>"
stability: stable
deprecated: false
parameters:
  - name: options
    location: argument
    type: CreateAdminClientOptions
    required: false
    description: ""
    children:
      - name: auth
        location: argument
        type: Pick<ClientAuth, "keyName">
        required: false
        description: Auth identity — key name from the verified request.
      - name: env
        location: argument
        type: Partial<SupabaseEnv>
        required: false
        description: Override auto-detected environment variables.
      - name: supabaseOptions
        location: argument
        type: SupabaseClientOptions<string>
        required: false
        description: Options forwarded to `createClient()`. `accessToken` is stripped; auth settings are force-overwritten.
returns:
  type: SupabaseClient<Database>
  description: ""
throws:
  - type: EnvError
    description: If `SUPABASE_URL` is missing or the specified secret key is not found.
examples:
  - id: basic-usage
    title: Basic usage
    lang: ts
    code: |
      // Uses the `default` secret key (or the first key if no `default` exists)
      const supabaseAdmin = createAdminClient()
      const { data } = await supabaseAdmin.from('audit_log').insert({ action: 'user_login' })
  - id: specific-named-key
    title: Specific named key
    lang: ts
    code: |
      const supabaseAdmin = createAdminClient({ auth: { keyName: 'internal' } })
---
