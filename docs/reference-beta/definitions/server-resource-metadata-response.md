---
id: server-resource-metadata-response
kind: method
category: Middleware
title: resourceMetadataResponse
symbol: "@supabase/server.resourceMetadataResponse"
summary: RFC 9728 OAuth Protected Resource Metadata response. Advertises the authorization server, resource URI, and bearer methods supported. URLs default to the Edge Functions derivation and throw off platform; pass `resource` / `authorizationServers` to override.
description: |-
  RFC 9728 OAuth Protected Resource Metadata response.
  Advertises the authorization server, resource URI, and bearer methods supported.
  URLs default to the Edge Functions derivation and throw off platform; pass
  `resource` / `authorizationServers` to override.
signature: "resourceMetadataResponse(req: Request, options?: ResourceMetadataOptions): Response"
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
    type: ResourceMetadataOptions
    required: false
    description: ""
    children:
      - name: resource
        location: argument
        type: string
        required: false
        description: Override the resource URI.
      - name: authorizationServers
        location: argument
        type: string[]
        required: false
        description: Override the authorization servers list.
returns:
  type: Response
  description: ""
throws: []
examples: []
---
