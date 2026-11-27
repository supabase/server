---
id: server-unauthorized-response
kind: method
category: Middleware
title: unauthorizedResponse
symbol: "@supabase/server.unauthorizedResponse"
summary: '`401` response with a `WWW-Authenticate: Bearer resource_metadata="..."` header (RFC 9728). The metadata URL defaults to the Edge Functions derivation and throws off platform; pass `resourceMetadataUrl` to override for custom setups.'
description: |-
  `401` response with a
  `WWW-Authenticate: Bearer resource_metadata="..."` header (RFC 9728).
  The metadata URL defaults to the Edge Functions derivation and throws off
  platform; pass `resourceMetadataUrl` to override for custom setups.
signature: "unauthorizedResponse(req: Request, options?: UnauthorizedResponseOptions): Response"
stability: stable
deprecated: false
parameters:
  - name: req
    location: argument
    type: Request
    required: true
    description: ""
  - name: options
    location: argument
    type: UnauthorizedResponseOptions
    required: false
    description: ""
    children:
      - name: resourceMetadataUrl
        location: argument
        type: string
        required: false
        description: Absolute URL override for the resource metadata endpoint.
returns:
  type: Response
  description: ""
throws: []
examples: []
---
