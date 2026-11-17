---
id: core-create-context-client
kind: method
category: Primitives
title: createContextClient
symbol: "@supabase/server/core.createContextClient"
summary: Creates a Supabase client scoped to the caller's context.
description: |-
  Creates a Supabase client scoped to the caller's context.

  Configured with a publishable key and (optionally) the caller's JWT,
  so Row-Level Security policies apply. Stateless — one client per request.

  ## Which key is used

  With `auth.keyName` set, that named key from `SUPABASE_PUBLISHABLE_KEYS` is
  used — and it throws if the key doesn't exist. With `keyName` omitted, the
  `default` key is used, falling back to the first key in the set when no
  `default` exists.

  Note this differs from the `"publishable"` auth mode, which matches the
  `default` key only and never falls back — see `AuthModeWithKey`.
signature: "createContextClient<Database>(options?: CreateContextClientOptions): SupabaseClient<Database>"
stability: stable
deprecated: false
parameters:
  - name: options
    location: argument
    type: CreateContextClientOptions
    required: false
    description: ""
    children:
      - name: auth
        location: argument
        type: ClientAuth
        required: false
        description: Auth identity — token and key name from the verified request.
        children:
          - name: token
            location: argument
            type: string | null
            required: false
            description: The caller's JWT, or `null` for anonymous access.
          - name: keyName
            location: argument
            type: string | null
            required: false
            description: Name of the API key to use. Falls back to `"default"`, then first available.
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
    description: If `SUPABASE_URL` is missing or the specified publishable key is not found.
examples:
  - id: with-verified-auth
    title: With verified auth
    lang: ts
    code: |
      const { data: auth } = await verifyAuth(request, { auth: 'user' })
      const supabase = createContextClient({
        auth: { token: auth.token, keyName: auth.keyName },
      })
      const { data } = await supabase.rpc('get_my_items')
---
