# MCP tools from your schema (`@supabase/server/mcp`)

> **Alpha.** `@supabase/server/mcp` tracks `@modelcontextprotocol/server` 2.x.
> Generated tool names, input schemas and annotations may change in a minor release.

Every MCP tool on a Supabase project used to be written by hand. `generateTools` builds them from what the project already contains: it reads the OpenAPI description PostgREST publishes for the caller and turns every operation into a tool. Add a table, get its tools. Grant execute on a function, get a tool for it. No tool code in between.

Think of it as the Data API exposed to MCP. The same client, the same role, the same Row Level Security. Whatever `ctx.supabase` can reach becomes a tool, unless your code removes or replaces it.

```ts
import { createMcpHandler, McpServer } from '@modelcontextprotocol/server'
import { withOAuthProtectedResource, withSupabase } from '@supabase/server'
import { generateTools, registerTools } from '@supabase/server/mcp'

Deno.serve(
  withOAuthProtectedResource(
    withSupabase({ auth: 'user' }, async (req, { supabase }) => {
      const handler = createMcpHandler(async () => {
        const server = new McpServer({ name: 'notes-mcp', version: '0.1.0' })
        registerTools(server, await generateTools(supabase))
        return server
      })
      return handler.fetch(req)
    }),
  ),
)
```

## Requirements

| Dependency                     | Version    | Why                                                                                          |
| ------------------------------ | ---------- | -------------------------------------------------------------------------------------------- |
| `@modelcontextprotocol/server` | `^2.0.0`   | Optional peer dependency. `registerTools` hands tools to its `McpServer`.                    |
| `@supabase/supabase-js`        | `2.115.0`+ | `generateTools` reads the description through `supabase.getOpenApiSpec()`, added in 2.115.0. |

On Supabase Edge Functions, disable the platform JWT check for the function in `supabase/config.toml` so the OAuth discovery route can be answered without a token. `withSupabase({ auth: 'user' })` still verifies every other request:

```toml
[functions.mcp]
verify_jwt = false
```

## What gets generated

`generateTools` returns a record keyed by tool name. Each entry is the argument shape `McpServer.registerTool()` takes — `description`, `inputSchema`, `annotations` — plus the `handler` that runs it and `_meta` recording where it came from.

| Tool                | Generated when                           | Arguments                                                                                   |
| ------------------- | ---------------------------------------- | ------------------------------------------------------------------------------------------- |
| `list_<relation>`   | the relation supports `GET`              | one equality filter per column, plus `order` (`column` or `column.desc`), `limit`, `offset` |
| `get_<relation>`    | `GET` and the relation has a primary key | the primary-key columns (all of them, for a composite key)                                  |
| `create_<relation>` | `POST`                                   | every column; required = `NOT NULL` columns without a default, excluding the primary key    |
| `update_<relation>` | `PATCH` and a primary key                | every column; the primary key is required and identifies the row, the rest are the changes  |
| `delete_<relation>` | `DELETE` and a primary key               | the primary-key columns                                                                     |
| `<function>`        | the function is exposed at `/rpc/<name>` | the function's arguments                                                                    |

Names carry no prefix — `list_notes` beats `postgrest_list_notes` when a model chooses between tools. Two operations that produce the same name (a function called `list_notes` next to a table `notes`) fail generation with [`TOOL_NAME_COLLISION`](error-handling.md#tool_name_collision) rather than silently replacing one.

Relations and functions are read from the schema the client was created with, so the tools describe exactly what they execute against. Views are relations too; PostgREST carries the base table's primary key over, so a simple view gets the same five tools as a table.

### Descriptions come from the database

`COMMENT ON` is the authoring surface. PostgREST includes comments in the description it publishes, so there is nothing else to configure:

```sql
comment on table expenses is 'Expense claims submitted by staff.';
comment on column expenses.memo is 'Short free-text justification.';

comment on function submit_expense is
  'Submit an expense for the signed-in user. Amounts over 500 require a manager.';
```

A table comment leads the description of every tool for that table; a column comment becomes the description of that argument; a function comment is the function tool's description. Where no comment exists, generation falls back to a plain sentence built from the operation and the name. It works, but a model choosing between tools is reading these strings — write the comments.

Column types are included in each argument's description (`Postgres type: uuid`, `Default: auth.uid()`), never as JSON Schema `format` or `default` keywords: PostgREST's type names vary by version, and a SQL default such as `now()` is not a JSON default.

### Annotations

| Operation                       | `readOnlyHint` | `destructiveHint` | `idempotentHint` | `openWorldHint` |
| ------------------------------- | -------------- | ----------------- | ---------------- | --------------- |
| `list_`, `get_`                 | `true`         | `false`           | `true`           | `false`         |
| `create_`                       | `false`        | `false`           | `false`          | `false`         |
| `update_`                       | `false`        | `true`            | `false`          | `false`         |
| `delete_`                       | `false`        | `true`            | `true`           | `false`         |
| function with `GET` on `/rpc/…` | `true`         | `false`           | `true`           | `false`         |
| function with `POST` only       | `false`        | `true`            | `false`          | `true`          |

PostgREST exposes `GET /rpc/<name>` only for `IMMUTABLE` and `STABLE` functions, which is what makes the read-only inference safe. A `VOLATILE` function may do anything — including reaching outside the project through an extension such as `pg_net` — so it alone is marked open-world.

Annotations are advisory. They do not replace grants, Row Level Security, or application-level authorization.

## Who sees which tools

The description is fetched with the caller's token, so it reflects the role in the JWT — on a normal project, `authenticated` for every signed-in user. **Every signed-in caller therefore sees the same tool set.** Row Level Security decides which rows a tool returns when it runs; it does not change the description.

Two things PostgREST does that are worth knowing:

- **Verbs are not filtered by grants.** A table the role may only `SELECT` from is still described with `POST`, `PATCH` and `DELETE`, so `create_`, `update_` and `delete_` tools are generated for it. Calling one fails with PostgREST's `permission denied` error, which the tool reports. Remove the entry before registration if you do not want the tool offered at all (see below).
- **Which relations appear depends on PostgREST's `openapi-mode`.** With `follow-privileges`, a relation the role has no privilege on at all is left out of the description. The Supabase CLI's local stack lists every relation in the exposed schemas regardless of role.

Either way, grants and RLS are enforced by Postgres when a tool runs, not by this package.

## Customizing and filtering

Generation returns ordinary objects, so plain JavaScript is enough. `tool.name` is authoritative for registration; the record key is an index, so none of this can accidentally rename a tool.

Replace a generated tool's implementation:

```ts
tools.get_notes.handler = async ({ id }) => {
  const { data, error } = await supabase
    .from('notes')
    .select('*')
    .eq('id', id)
    .single()
  if (error) throw error
  return { content: [{ type: 'text', text: JSON.stringify(data) }] }
}
```

Exclude a tool, or register a subset:

```ts
delete tools.delete_notes

registerTools(server, { list_notes: tools.list_notes })
```

Filter on `_meta` — every tool backed by one table, or only the function-backed tools:

```ts
const noteTools = Object.fromEntries(
  Object.entries(tools).filter(([, tool]) => tool._meta.name === 'notes'),
)

const functionTools = Object.fromEntries(
  Object.entries(tools).filter(([, tool]) => tool._meta.kind === 'function'),
)

registerTools(server, functionTools)
```

Hand-written tools go straight onto the SDK, next to the generated ones. If a hand-written tool shares a name with a generated one, replace or remove the generated entry first — the SDK refuses to register the same name twice.

## Errors

Both are [`ToolGenerationError`](error-handling.md#toolgenerationerror-codes)s with `status: 500`:

| Code                                                           | Cause                                                                                                                                                                                                                           |
| -------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [`SPEC_FETCH_FAILED`](error-handling.md#spec_fetch_failed)     | The description could not be read: PostgREST answered 404/406 (OpenAPI output disabled), 401/403 (credentials), or the body is not a Swagger 2.0 document. Also raised when the supabase-js client predates `getOpenApiSpec()`. |
| [`TOOL_NAME_COLLISION`](error-handling.md#tool_name_collision) | Two operations produce the same tool name. `details` carries the name and both operations.                                                                                                                                      |

Errors thrown by a tool's handler — PostgREST rejections, a missing row — are turned into tool errors by the MCP SDK, so the model sees PostgREST's message, details, hint and code.

## Known limitations

- The description is read on every call to `generateTools`, so a server that generates per request pays for one extra PostgREST request per MCP message. No caching yet.
- A `create_` tool asks for every required column except primary keys and columns with defaults. A table whose primary key is a natural text code rather than an identity column fails on create until the tool is overridden.
- A function tool cannot document its individual arguments; Postgres has nowhere to store that text.
- Generated names are the relation and function names as-is. MCP tool names must match `[A-Za-z0-9._-]` and stay under 128 characters; a relation name outside that is rejected by the SDK at registration.
- `list_` filters are equality only, and columns literally named `order`, `limit` or `offset` cannot be filtered on. Advanced filters, joins and full-text search are written by hand.
- Results are JSON text. No `outputSchema` or `structuredContent` yet.
- The tool list is a contract with the client, and schema changes break it silently: drop a table and its tools disappear on the next `tools/list`; rename one and its tools are renamed. Treat a relation or function an agent depends on the way you would treat a public API — add the new one, migrate, then remove the old.
