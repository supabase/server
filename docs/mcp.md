# MCP servers

> **Alpha.** `withOAuthProtectedResource` and composing `withSupabase` as a
> `pipeline` entry track `@supabase/middleware` 0.x. The config shape, the
> contributed context key, and the metadata route may change in a minor
> release. The nested `withOAuthProtectedResource(withSupabase(config, handler))`
> form is stable.

An MCP server your app exposes to its users is an HTTP endpoint that MCP clients (Claude, ChatGPT, Cursor, VS Code, Claude Code) call after an OAuth 2.1 flow. `@supabase/server` covers the two Supabase-specific parts: OAuth discovery for the client, and turning the user's token into an RLS-scoped Supabase client for your tools. The MCP transport and the tools come from any MCP library.

```ts
import { pipeline } from '@supabase/middleware'
import { withOAuthProtectedResource, withSupabase } from '@supabase/server'
import { createMcpHandler, McpServer } from '@modelcontextprotocol/server'
import { z } from 'zod/v4'
import type { Database } from './database.types'

export default {
  fetch: pipeline(
    [withOAuthProtectedResource(), withSupabase<Database>({ auth: 'user' })],
    async (req, { supabase }) => {
      const handler = createMcpHandler(
        () => {
          const server = new McpServer({ name: 'todos', version: '0.1.0' })
          server.registerTool(
            'create_todo',
            {
              description: 'Create a todo',
              inputSchema: z.object({ title: z.string() }),
            },
            async ({ title }) => {
              const { data, error } = await supabase
                .from('todos')
                .insert({ title })
                .select()
                .single()
              if (error) throw new Error(error.message)
              return { content: [{ type: 'text', text: JSON.stringify(data) }] }
            },
          )
          return server
        },
        // Factory errors (duplicate tool name, failed schema fetch) surface as a
        // bare 500 otherwise; log them so they reach the function logs.
        { onerror: (error) => console.error('MCP request failed', error) },
      )
      return handler.fetch(req)
    },
  ),
}
```

Pass the `Database` generic (from `supabase gen types typescript`) when tools write. Without it the client is `SupabaseClient<unknown>` and `insert({ title })` fails type-checking with the argument resolved to `never[]`; reads compile either way.

## The two entries

Order matters.

`withOAuthProtectedResource()` runs **before** the auth gate, so it sees unauthenticated requests. It does two things:

| Request                                       | Response                                                                                               |
| --------------------------------------------- | ------------------------------------------------------------------------------------------------------ |
| `GET {resource}/oauth-protected-resource`     | RFC 9728 Protected Resource Metadata (`resource`, `authorization_servers`, `bearer_methods_supported`) |
| `OPTIONS {resource}/oauth-protected-resource` | `204` with permissive CORS headers, so browser-based clients can read the document cross-origin        |
| Any response from below with status `401`     | Adds `WWW-Authenticate: Bearer resource_metadata="…"` unless the handler already set one               |

That header is how a client that hit a `401` finds the metadata, and through it the authorization server, without guessing URLs. It is generic OAuth middleware; the only MCP-specific detail is that the preflight allows the `mcp-protocol-version` request header.

`withSupabase({ auth: 'user' })` is the gate. Requests without a valid user JWT get a `401` (which the entry above enriches); requests with one reach the handler with `ctx.supabase` scoped to that user, so RLS applies to everything the tools do.

The handler is passed inline. Passing a separately declared function typed `(req: Request, ctx: SupabaseContext) => Promise<Response>` makes TypeScript collapse the inferred context to `object` (TS2345); wrap it as `(req, ctx) => handleMcp(req, ctx)` instead.

## URLs

On Supabase Edge Functions the metadata is derived with no configuration: the public origin from the gateway's `X-Forwarded-*` headers (`SUPABASE_PUBLIC_URL` wins when set, but the CLI does not set it), the path as `/functions/v1/{SUPABASE_FUNCTION_SLUG}`, and the issuer as `{origin}/auth/v1`. Supabase CLI 2.117.0 or later injects the slug locally. Without a slug the path is reconstructed from the request, which works for a function served at `/functions/v1/{name}`; a function served at the root path `/` with no slug answers with a 500 and code `MISSING_RESOURCE_SERVER`, because there is no function segment to restore.

Anywhere else, a Next.js route handler, a Worker, a plain server, the app's origin is unrelated to the project's, so pass both URLs:

```ts
import { withOAuthProtectedResource, fromSupabaseUrl } from '@supabase/server'

withOAuthProtectedResource({
  resourceServer: (req) => new URL(req.url).origin + '/api/mcp',
  authorizationServer: fromSupabaseUrl('https://<ref>.supabase.co'),
})
```

- `resourceServer`: the public URL of this endpoint. Required off Edge Functions; every request is answered with a 500 and code `MISSING_RESOURCE_SERVER` otherwise.
- `authorizationServer`: the OAuth issuer. Falls back to `SUPABASE_PUBLIC_URL`, then `SUPABASE_URL`, each with `/auth/v1`; the metadata route answers with a 500 and code `MISSING_AUTHORIZATION_SERVER` if neither is set. `fromSupabaseUrl(projectUrl)` builds it from a project URL. A non-Supabase OAuth 2.1 server (Clerk, WorkOS, Auth0) works too.

Both accept a string or `(req: Request) => string` (`UrlOption`). The full config:

| Option                | Type        | Default on Edge Functions             | Default elsewhere                                                                                                  |
| --------------------- | ----------- | ------------------------------------- | ------------------------------------------------------------------------------------------------------------------ |
| `resourceServer`      | `UrlOption` | `{public origin}/functions/v1/{slug}` | none; `500` with code `MISSING_RESOURCE_SERVER`                                                                    |
| `authorizationServer` | `UrlOption` | `{public origin}/auth/v1`             | `SUPABASE_PUBLIC_URL`, then `SUPABASE_URL`, each `+ /auth/v1`; else `500` with code `MISSING_AUTHORIZATION_SERVER` |

Either 500 is the library's JSON error response, with the code in the `x-supabase-server-error` header and a `hint` naming the option to set; see [`docs/error-handling.md`](error-handling.md#enverror-codes). A throw from a `resourceServer` or `authorizationServer` function you supplied is yours and propagates. `errors: { detailed: false }` trims either body to `code` and `message`.

The middleware contributes `ctx.oauthProtectedResource.resourceMetadataUrl`, the resolved metadata URL, to the downstream context.

## Supabase Auth prerequisites

The project must have the OAuth 2.1 server enabled, dynamic client registration on (MCP clients register themselves), an asymmetric signing key (ES256 or RS256), and a consent screen hosted in the app's frontend. The signing key requirement comes from this library, not from OAuth: `withSupabase({ auth: 'user' })` verifies user JWTs against the project JWKS and rejects legacy HS256 tokens (see [`docs/auth-modes.md`](auth-modes.md#legacy-keys-and-jwts-are-not-supported)). On Edge Functions set `verify_jwt = false` for the function in `config.toml`; the gate does the verification, and the gateway must let the unauthenticated discovery request through.

## Escape hatches

For custom routing, the pieces behind the middleware are exported on `@supabase/server/oauth-protected-resource`: `resourceMetadataResponse(req, options?)` returns the metadata document, `unauthorizedResponse(req, options?)` returns a `401` with the `WWW-Authenticate` header.

## Limits

The one-request, one-response shape above is the handler's, not the library's: building a `McpServer` per request with `createMcpHandler` gives Streamable HTTP in its simplest form, with no server-initiated stream, so no MCP sampling and no elicitations that need an open channel. `@supabase/server` does not constrain the transport; a stateful transport composes the same way.

## See also

- [Deploy MCP servers](https://supabase.com/docs/guides/ai-tools/byo-mcp) on supabase.com, the end-to-end guide
- [MCP Server block](https://supabase.com/library/docs/headless/mcp-server), an installable Edge Function built on this
- [`docs/api-reference.md`](api-reference.md#withoauthprotectedresource) for `OAuthProtectedResourceConfig` and the error catalogue
