import {
  fromJsonSchema,
  type JsonSchemaType,
  type McpServer,
} from '@modelcontextprotocol/server'

import type { GeneratedTool } from './types.js'

/**
 * Registers generated tools on an `McpServer` from `@modelcontextprotocol/server`.
 *
 * Each tool's JSON Schema is handed to the SDK's own `fromJsonSchema()`, so the
 * SDK validates arguments and advertises the schema in `tools/list`. `_meta` is
 * not forwarded. A name that is already registered — a hand-written tool with
 * the same name — surfaces as the SDK's own error; replace or remove the
 * generated entry first.
 *
 * @example
 * ```ts
 * const tools = await generateTools(supabase)
 * delete tools.delete_notes
 * registerTools(server, tools)
 * ```
 *
 * @category MCP
 */
export function registerTools(
  server: Pick<McpServer, 'registerTool'>,
  tools: Record<string, GeneratedTool>,
): void {
  for (const tool of Object.values(tools)) {
    server.registerTool(
      tool.name,
      {
        description: tool.description,
        annotations: tool.annotations,
        inputSchema: fromJsonSchema<Record<string, unknown>>(
          tool.inputSchema as JsonSchemaType,
        ),
      },
      (args) => tool.handler(args),
    )
  }
}
