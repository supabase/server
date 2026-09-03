/**
 * **Alpha.** MCP tools generated at run time from a project's PostgREST schema.
 *
 * `generateTools` reads the OpenAPI description PostgREST publishes for the
 * caller's role — through the caller-scoped `ctx.supabase` client — and builds
 * one tool per operation: `list_`, `get_`, `create_`, `update_` and `delete_`
 * for every table and view the role can reach, and one tool per database
 * function. Descriptions come from `COMMENT ON`; Row Level Security applies
 * when a tool runs. `registerTools` hands them to the official MCP SDK.
 *
 * ```ts
 * import { createMcpHandler, McpServer } from '@modelcontextprotocol/server'
 * import { withOAuthProtectedResource, withSupabase } from '@supabase/server'
 * import { generateTools, registerTools } from '@supabase/server/mcp'
 *
 * Deno.serve(
 *   withOAuthProtectedResource(
 *     withSupabase({ auth: 'user' }, async (req, { supabase }) => {
 *       const handler = createMcpHandler(async () => {
 *         const server = new McpServer({ name: 'notes-mcp', version: '0.1.0' })
 *         registerTools(server, await generateTools(supabase))
 *         return server
 *       })
 *       return handler.fetch(req)
 *     }),
 *   ),
 * )
 * ```
 *
 * Requires `@modelcontextprotocol/server` 2.x (optional peer dependency) and
 * `@supabase/supabase-js` 2.115.0 or newer. Generated tool names, input
 * schemas and annotations may change in a minor release while this surface is
 * alpha.
 *
 * @alpha
 * @module
 * @packageDocumentation
 */

export { generateTools } from './generate.js'
export { registerTools } from './register.js'
export type { GeneratedTool, ToolMeta } from './types.js'
