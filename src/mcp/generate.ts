import type {
  PostgrestError,
  PostgrestOpenApiSpec,
  SupabaseClient,
} from '@supabase/supabase-js'
import type {
  CallToolResult,
  ToolAnnotations,
} from '@modelcontextprotocol/server'

import {
  Errors,
  SpecFetchFailedError,
  ToolNameCollisionError,
} from '../errors.js'
import type { GeneratedTool, ToolMeta } from './types.js'

// The parts of PostgREST's Swagger 2.0 document read here. Shapes were read off
// a running PostgREST (see src/mcp/__fixtures__/probe-spec.ts), not inferred.
interface SwaggerProperty {
  type?: string
  format?: string
  default?: unknown
  description?: string
  enum?: unknown[]
  items?: { type?: string }
}

interface SwaggerDefinition {
  description?: string
  required?: string[]
  properties?: Record<string, SwaggerProperty>
}

interface SwaggerParameter {
  in?: string
  schema?: {
    required?: string[]
    properties?: Record<string, SwaggerProperty>
  }
}

interface SwaggerOperation {
  summary?: string
  parameters?: Array<SwaggerParameter | { $ref: string }>
}

type JsonSchema = Record<string, unknown>

/**
 * Table and function names are only known at run time, so the query builders
 * run on the untyped client. Callers keep their `SupabaseClient<Database>`.
 */
type Client = SupabaseClient

/** PostgREST marks primary-key columns with this literal in the description. */
const PK_MARKER = '<pk/>'

/** `list_` arguments that are not column filters. */
const RESERVED = new Set(['order', 'limit', 'offset'])

const READ_ONLY: ToolAnnotations = {
  readOnlyHint: true,
  destructiveHint: false,
  idempotentHint: true,
  openWorldHint: false,
}

/**
 * Generates one MCP tool per operation PostgREST exposes to the client's role.
 *
 * The description is fetched through `supabase.getOpenApiSpec()`, so it
 * carries the caller's token and the client's schema: tools exist only for the
 * tables, views and functions the caller's role holds privileges on. When a
 * tool runs, the same client executes it and Row Level Security applies.
 *
 * Returned as a record keyed by tool name. `tool.name` is authoritative; the
 * key is an index for ergonomics, so overriding entries cannot rename a tool.
 *
 * @example
 * ```ts
 * const tools = await generateTools(supabase)
 * // tools.list_notes, tools.create_notes, tools.submit_expense, …
 * delete tools.delete_notes
 * registerTools(server, tools)
 * ```
 *
 * @throws {ToolGenerationError} `SPEC_FETCH_FAILED` when the description cannot
 *   be read, `TOOL_NAME_COLLISION` when two operations produce the same name.
 * @category MCP
 */
export async function generateTools<Database = unknown>(
  supabase: SupabaseClient<Database>,
): Promise<Record<string, GeneratedTool>> {
  return generateToolDefinitions(supabase, await fetchSpec(supabase))
}

/**
 * Fetches the Swagger 2.0 description PostgREST publishes for the client's
 * schema, scoped to the caller. One call to supabase-js; nothing here builds
 * a request or holds a credential.
 *
 * @internal
 */
export async function fetchSpec<Database = unknown>(
  supabase: SupabaseClient<Database>,
): Promise<PostgrestOpenApiSpec> {
  if (typeof supabase.getOpenApiSpec !== 'function') {
    throw Errors[SpecFetchFailedError]({ reason: 'unsupported-client' })
  }
  const { data, error, status } = await supabase.getOpenApiSpec()
  if (error) {
    throw Errors[SpecFetchFailedError]({
      reason: 'request',
      status,
      message: error.message,
      cause: error,
    })
  }
  if (!isSwaggerDocument(data)) {
    throw Errors[SpecFetchFailedError]({ reason: 'malformed', status })
  }
  return data
}

function isSwaggerDocument(value: unknown): value is PostgrestOpenApiSpec {
  return (
    typeof value === 'object' &&
    value !== null &&
    typeof (value as { swagger?: unknown }).swagger === 'string' &&
    typeof (value as { paths?: unknown }).paths === 'object' &&
    typeof (value as { definitions?: unknown }).definitions === 'object'
  )
}

/**
 * Pure: a description in, tools out. Handlers close over `supabase` but nothing
 * is fetched here.
 *
 * @internal
 */
export function generateToolDefinitions<Database = unknown>(
  supabase: SupabaseClient<Database>,
  spec: PostgrestOpenApiSpec,
): Record<string, GeneratedTool> {
  const client = supabase as unknown as Client
  const tools: Record<string, GeneratedTool> = {}

  const add = (tool: GeneratedTool): void => {
    const existing = tools[tool.name]
    if (existing) {
      throw Errors[ToolNameCollisionError]({
        name: tool.name,
        operations: [describeMeta(existing._meta), describeMeta(tool._meta)],
      })
    }
    tools[tool.name] = tool
  }

  for (const relation of relations(spec)) {
    for (const tool of relationTools(client, relation)) add(tool)
  }
  for (const fn of databaseFunctions(spec)) add(functionTool(client, fn))

  return tools
}

function describeMeta(meta: ToolMeta): string {
  return `${meta.kind} "${meta.name}" (${meta.method})`
}

// ---------------------------------------------------------------------------
// Relations: tables and views
// ---------------------------------------------------------------------------

interface Relation {
  name: string
  definition: SwaggerDefinition
  verbs: Set<string>
}

function relations(spec: PostgrestOpenApiSpec): Relation[] {
  const found: Relation[] = []
  for (const [path, operations] of Object.entries(spec.paths)) {
    if (path === '/' || path.startsWith('/rpc/')) continue
    const name = path.slice(1)
    const definition = spec.definitions?.[name] as SwaggerDefinition | undefined
    if (!definition) continue
    found.push({ name, definition, verbs: new Set(Object.keys(operations)) })
  }
  return found
}

function relationTools(
  client: Client,
  { name, definition, verbs }: Relation,
): GeneratedTool[] {
  const properties = definition.properties ?? {}
  const columns = Object.keys(properties)
  const primaryKey = columns.filter((column) =>
    properties[column].description?.includes(PK_MARKER),
  )
  const comment = cleanDescription(definition.description)
  const describe = (sentence: string): string =>
    [comment, sentence].filter(Boolean).join(' ')
  const columnSchemas = (names: string[]): Record<string, JsonSchema> =>
    Object.fromEntries(
      names.map((column) => [column, columnSchema(properties[column])]),
    )
  const notFound = (key: Record<string, unknown>): Error =>
    new Error(`No row of "${name}" matches ${JSON.stringify(key)}.`)

  const tools: GeneratedTool[] = []

  if (verbs.has('get')) {
    const filterable = columns.filter(
      (column) => isScalar(properties[column]) && !RESERVED.has(column),
    )
    tools.push({
      name: `list_${name}`,
      description: describe(
        `Lists rows of "${name}". Each column argument is an equality filter; combine with order, limit and offset.`,
      ),
      inputSchema: objectSchema({
        ...columnSchemas(filterable),
        order: {
          type: 'string',
          description: `Column to sort by, optionally followed by ".asc" or ".desc" (for example "created_at.desc"). Columns: ${columns.join(', ')}.`,
        },
        limit: {
          type: 'integer',
          minimum: 1,
          maximum: 1000,
          description: 'Maximum number of rows to return. Default 100.',
        },
        offset: {
          type: 'integer',
          minimum: 0,
          description: 'Number of rows to skip. Default 0.',
        },
      }),
      annotations: READ_ONLY,
      _meta: { kind: 'relation', name, method: 'GET' },
      handler: async (args) => {
        const { order, limit, offset, ...filters } = args
        let query = client.from(name).select('*')
        for (const [column, value] of Object.entries(filters)) {
          if (value === undefined || !filterable.includes(column)) continue
          query = query.eq(column, value)
        }
        if (typeof order === 'string' && order !== '') {
          const sort = parseOrder(order, columns)
          query = query.order(sort.column, { ascending: sort.ascending })
        }
        const from = typeof offset === 'number' ? offset : 0
        const size = typeof limit === 'number' ? limit : 100
        return toResult(await query.range(from, from + size - 1))
      },
    })
  }

  if (verbs.has('get') && primaryKey.length > 0) {
    tools.push({
      name: `get_${name}`,
      description: describe(`Fetches one row of "${name}" by primary key.`),
      inputSchema: objectSchema(columnSchemas(primaryKey), primaryKey),
      annotations: READ_ONLY,
      _meta: { kind: 'relation', name, method: 'GET' },
      handler: async (args) => {
        const key = pick(args, primaryKey)
        const { data, error } = await client
          .from(name)
          .select('*')
          .match(key)
          .maybeSingle()
        if (error) throw postgrestError(error)
        if (data === null) throw notFound(key)
        return textResult(data)
      },
    })
  }

  if (verbs.has('post')) {
    // `required` in the description is the NOT NULL list. Columns with a
    // database default need no value, and an identity primary key cannot take
    // one at all — Postgres rejects it without OVERRIDING SYSTEM VALUE.
    const required = (definition.required ?? []).filter(
      (column) =>
        column in properties &&
        properties[column].default === undefined &&
        !primaryKey.includes(column),
    )
    tools.push({
      name: `create_${name}`,
      description: describe(`Inserts one row into "${name}" and returns it.`),
      inputSchema: objectSchema(columnSchemas(columns), required),
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: false,
        openWorldHint: false,
      },
      _meta: { kind: 'relation', name, method: 'POST' },
      handler: async (args) =>
        toResult(await client.from(name).insert(args).select('*').single()),
    })
  }

  if (verbs.has('patch') && primaryKey.length > 0) {
    tools.push({
      name: `update_${name}`,
      description: describe(
        `Updates one row of "${name}" by primary key and returns it. Only the columns given change.`,
      ),
      inputSchema: objectSchema(columnSchemas(columns), primaryKey),
      annotations: {
        readOnlyHint: false,
        destructiveHint: true,
        idempotentHint: false,
        openWorldHint: false,
      },
      _meta: { kind: 'relation', name, method: 'PATCH' },
      handler: async (args) => {
        const key = pick(args, primaryKey)
        const changes = Object.fromEntries(
          Object.entries(args).filter(
            ([column, value]) =>
              !primaryKey.includes(column) && value !== undefined,
          ),
        )
        if (Object.keys(changes).length === 0) {
          throw new Error(
            `Nothing to update in "${name}": pass at least one column besides the primary key.`,
          )
        }
        const { data, error } = await client
          .from(name)
          .update(changes)
          .match(key)
          .select('*')
          .maybeSingle()
        if (error) throw postgrestError(error)
        if (data === null) throw notFound(key)
        return textResult(data)
      },
    })
  }

  if (verbs.has('delete') && primaryKey.length > 0) {
    tools.push({
      name: `delete_${name}`,
      description: describe(
        `Deletes one row of "${name}" by primary key and returns it.`,
      ),
      inputSchema: objectSchema(columnSchemas(primaryKey), primaryKey),
      annotations: {
        readOnlyHint: false,
        destructiveHint: true,
        idempotentHint: true,
        openWorldHint: false,
      },
      _meta: { kind: 'relation', name, method: 'DELETE' },
      handler: async (args) => {
        const key = pick(args, primaryKey)
        const { data, error } = await client
          .from(name)
          .delete()
          .match(key)
          .select('*')
          .maybeSingle()
        if (error) throw postgrestError(error)
        if (data === null) throw notFound(key)
        return textResult(data)
      },
    })
  }

  return tools
}

function parseOrder(
  order: string,
  columns: string[],
): { column: string; ascending: boolean } {
  const match = /^(.+?)(?:\.(asc|desc))?$/.exec(order)
  const column = match?.[1] ?? order
  if (!columns.includes(column)) {
    throw new Error(
      `Cannot order by "${column}": not a column. Columns: ${columns.join(', ')}.`,
    )
  }
  return { column, ascending: match?.[2] !== 'desc' }
}

// ---------------------------------------------------------------------------
// Database functions: /rpc/<name>
// ---------------------------------------------------------------------------

interface DatabaseFunction {
  name: string
  /** PostgREST exposes GET only for IMMUTABLE and STABLE functions. */
  hasGet: boolean
  summary?: string
  args: { required?: string[]; properties?: Record<string, SwaggerProperty> }
}

function databaseFunctions(spec: PostgrestOpenApiSpec): DatabaseFunction[] {
  const found: DatabaseFunction[] = []
  for (const [path, operations] of Object.entries(spec.paths)) {
    if (!path.startsWith('/rpc/')) continue
    const post = operations.post as SwaggerOperation | undefined
    if (!post) continue
    const body = (post.parameters ?? [])
      .map((parameter) => resolveParameter(spec, parameter))
      .find((parameter) => parameter?.in === 'body')
    found.push({
      name: path.slice('/rpc/'.length),
      hasGet: 'get' in operations,
      summary: post.summary,
      args: body?.schema ?? {},
    })
  }
  return found
}

/** Resolves a `#/parameters/<key>` reference one level; inline values pass through. */
function resolveParameter(
  spec: PostgrestOpenApiSpec,
  parameter: SwaggerParameter | { $ref: string },
): SwaggerParameter | undefined {
  if (!('$ref' in parameter)) return parameter
  const match = /^#\/parameters\/(.+)$/.exec(parameter.$ref)
  if (!match) return undefined
  const key = match[1].replace(/~1/g, '/').replace(/~0/g, '~')
  return spec.parameters?.[key] as SwaggerParameter | undefined
}

function functionTool(client: Client, fn: DatabaseFunction): GeneratedTool {
  const properties = fn.args.properties ?? {}
  return {
    name: fn.name,
    description:
      cleanDescription(fn.summary) ??
      `Calls the database function "${fn.name}".`,
    inputSchema: objectSchema(
      Object.fromEntries(
        Object.entries(properties).map(([arg, property]) => [
          arg,
          columnSchema(property),
        ]),
      ),
      fn.args.required,
    ),
    // A VOLATILE function may do anything, including reaching outside the
    // project through an extension such as pg_net — hence openWorldHint.
    annotations: fn.hasGet
      ? READ_ONLY
      : {
          readOnlyHint: false,
          destructiveHint: true,
          idempotentHint: false,
          openWorldHint: true,
        },
    _meta: {
      kind: 'function',
      name: fn.name,
      method: fn.hasGet ? 'GET' : 'POST',
    },
    handler: async (args) =>
      toResult(await client.rpc(fn.name, args, { get: fn.hasGet })),
  }
}

// ---------------------------------------------------------------------------
// Swagger → JSON Schema
// ---------------------------------------------------------------------------

const JSON_SCHEMA_TYPES = new Set([
  'string',
  'integer',
  'number',
  'boolean',
  'array',
  'object',
])

function isScalar(property: SwaggerProperty): boolean {
  return (
    property.type === 'string' ||
    property.type === 'integer' ||
    property.type === 'number' ||
    property.type === 'boolean'
  )
}

/**
 * The Swagger property as JSON Schema. `type` and `enum` carry over; `format`
 * (which varies by PostgREST version) and the SQL `default` go into the
 * description for the model's benefit, never as validation keywords.
 */
function columnSchema(property: SwaggerProperty): JsonSchema {
  const schema: JsonSchema = {}
  if (property.type && JSON_SCHEMA_TYPES.has(property.type)) {
    schema.type = property.type
  }
  if (
    property.type === 'array' &&
    property.items?.type &&
    JSON_SCHEMA_TYPES.has(property.items.type)
  ) {
    schema.items = { type: property.items.type }
  }
  if (property.enum) schema.enum = property.enum
  const description = [
    cleanDescription(property.description),
    property.format ? `Postgres type: ${property.format}.` : undefined,
    property.default !== undefined
      ? `Default: ${String(property.default)}.`
      : undefined,
  ]
    .filter(Boolean)
    .join(' ')
  if (description) schema.description = description
  return schema
}

function objectSchema(
  properties: Record<string, JsonSchema>,
  required: string[] = [],
): JsonSchema {
  return {
    type: 'object',
    properties,
    ...(required.length > 0 ? { required } : {}),
    additionalProperties: false,
  }
}

/**
 * Strips PostgREST's key markup from a comment. The primary key is expressed
 * by the tool schemas instead; the foreign-key sentence is kept because it
 * tells the model what the column points at.
 */
function cleanDescription(text: string | undefined): string | undefined {
  if (!text) return undefined
  const cleaned = text
    .replace(/<pk\/>/g, '')
    .replace(/<fk [^>]*\/>/g, '')
    .split('\n')
    .map((line) => line.trim())
    .filter(
      (line) =>
        line !== '' &&
        line !== 'Note:' &&
        !line.startsWith('This is a Primary Key'),
    )
    .join(' ')
    .trim()
  return cleaned === '' ? undefined : cleaned
}

// ---------------------------------------------------------------------------
// Execution
// ---------------------------------------------------------------------------

function pick(
  args: Record<string, unknown>,
  keys: string[],
): Record<string, unknown> {
  return Object.fromEntries(keys.map((key) => [key, args[key]]))
}

function textResult(data: unknown): CallToolResult {
  return { content: [{ type: 'text', text: JSON.stringify(data) }] }
}

function toResult(response: {
  data: unknown
  error: PostgrestError | null
}): CallToolResult {
  if (response.error) throw postgrestError(response.error)
  return textResult(response.data)
}

/**
 * A thrown error becomes a tool error in the MCP SDK. The message carries
 * everything PostgREST said so the model can act on it.
 */
function postgrestError(error: PostgrestError): Error {
  const parts = [
    error.message,
    error.details,
    error.hint ? `Hint: ${error.hint}` : '',
    error.code ? `(${error.code})` : '',
  ].filter(Boolean)
  return new Error(parts.join(' '), { cause: error })
}
