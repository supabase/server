import type {
  CallToolResult,
  ToolAnnotations,
} from '@modelcontextprotocol/server'

/**
 * What a generated tool was derived from. Read it to filter or group tools
 * before registration — {@link registerTools} strips it, so it never reaches
 * `tools/list`.
 *
 * @example Register only the function-backed tools
 * ```ts
 * const functionTools = Object.fromEntries(
 *   Object.entries(tools).filter(([, tool]) => tool._meta.kind === 'function'),
 * )
 * registerTools(server, functionTools)
 * ```
 *
 * @category Types
 */
export interface ToolMeta {
  /** `relation` for a table or view, `function` for a database function. */
  kind: 'relation' | 'function'
  /** The table, view, or function the tool was generated from. */
  name: string
  /** The HTTP verb the tool sends to PostgREST. */
  method: 'GET' | 'POST' | 'PATCH' | 'DELETE'
}

/**
 * A tool generated from the PostgREST description. The shape is what
 * `McpServer.registerTool()` takes — `description`, `inputSchema`,
 * `annotations` — plus the `handler` that runs it and {@link ToolMeta}.
 *
 * Generated tools are plain objects: replace a `handler`, `delete` an entry,
 * or pick a subset with ordinary JavaScript before calling
 * {@link registerTools}.
 *
 * @category Types
 */
export interface GeneratedTool {
  /**
   * The tool name, e.g. `list_notes`. Authoritative for registration; the key
   * in the record {@link generateTools} returns is only an index.
   */
  name: string
  /** From `COMMENT ON` when present, otherwise built from the operation and name. */
  description: string
  /** JSON Schema for the tool arguments, as PostgREST describes them. */
  inputSchema: Record<string, unknown>
  /** Read-only / destructive / idempotent / open-world hints for the operation. */
  annotations: ToolAnnotations
  /** Provenance, for filtering before registration. */
  _meta: ToolMeta
  /** Runs the operation through the Supabase client generation received. */
  handler: (args: Record<string, unknown>) => Promise<CallToolResult>
}
