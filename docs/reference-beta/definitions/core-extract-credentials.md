---
id: core-extract-credentials
kind: method
category: Primitives
title: extractCredentials
symbol: "@supabase/server/core.extractCredentials"
summary: Extracts authentication credentials from an incoming HTTP request.
description: |-
  Extracts authentication credentials from an incoming HTTP request.

  Reads two headers:
  - `Authorization: Bearer <token>` → extracted as `token`
  - `apikey: <key>` → extracted as `apikey`

  This is a pure extraction step — no validation or verification is performed.
  Pass the result to `verifyCredentials` to validate against allowed auth modes.
signature: "extractCredentials(request: Request): Credentials"
stability: stable
deprecated: false
parameters:
  - name: request
    location: argument
    type: Request
    required: true
    description: The incoming HTTP request.
returns:
  type: Credentials
  description: The extracted `Credentials`. Fields are `null` when the corresponding header is absent.
throws: []
examples:
  - id: basic-usage
    title: Basic usage
    lang: ts
    code: |
      import { extractCredentials } from '@supabase/server/core'

      const creds = extractCredentials(request)
      console.log(creds.token)  // "eyJhbGci..." or null
      console.log(creds.apikey) // "sb-abc123-publishable-..." or null
---
