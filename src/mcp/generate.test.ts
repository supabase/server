import { fromJsonSchema } from '@modelcontextprotocol/server'
import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import { describe, expect, it } from 'vitest'

import {
  SpecFetchFailedError,
  ToolGenerationError,
  ToolNameCollisionError,
} from '../errors.js'
import {
  probeSpec,
  probeSpecWithCollision,
  withoutPaths,
} from './__fixtures__/probe-spec.js'
import {
  fetchSpec,
  generateToolDefinitions,
  generateTools,
} from './generate.js'
import type { GeneratedTool } from './types.js'

const PROJECT_URL = 'https://project.supabase.co'
const PUBLISHABLE_KEY = 'sb_publishable_test'

interface Recorded {
  method: string
  url: URL
  headers: Headers
  body: unknown
}

interface Reply {
  status?: number
  body: unknown
}

/**
 * A real supabase-js client whose fetch records every request and answers from
 * a queue, so handler tests assert the exact PostgREST request without a
 * network. The Authorization header stands in for the caller's JWT.
 */
function recordingClient(replies: Reply[] = [{ body: [] }]) {
  const calls: Recorded[] = []
  const queue = [...replies]
  const fetchImpl: typeof fetch = async (input, init) => {
    const href =
      typeof input === 'string'
        ? input
        : input instanceof URL
          ? input.href
          : input.url
    calls.push({
      method: init?.method ?? 'GET',
      url: new URL(href),
      headers: new Headers(init?.headers),
      body: typeof init?.body === 'string' ? JSON.parse(init.body) : undefined,
    })
    const reply = queue.shift() ?? { body: [] }
    return new Response(JSON.stringify(reply.body), {
      status: reply.status ?? 200,
      headers: { 'content-type': 'application/json' },
    })
  }
  const client = createClient(PROJECT_URL, PUBLISHABLE_KEY, {
    global: { fetch: fetchImpl, headers: { Authorization: 'Bearer user-jwt' } },
  })
  return { client, calls }
}

/** A client that must never be called: generation itself does no I/O. */
const untouched = (): SupabaseClient =>
  createClient(PROJECT_URL, PUBLISHABLE_KEY, {
    global: {
      fetch: () => {
        throw new Error('generation must not perform requests')
      },
    },
  })

const READ_ONLY = {
  readOnlyHint: true,
  destructiveHint: false,
  idempotentHint: true,
  openWorldHint: false,
}

const text = (data: unknown) => ({
  content: [{ type: 'text', text: JSON.stringify(data) }],
})

const properties = (tool: GeneratedTool) =>
  tool.inputSchema.properties as Record<string, Record<string, unknown>>

describe('generateToolDefinitions - which tools exist', () => {
  const tools = generateToolDefinitions(untouched(), probeSpec)

  it('generates one tool per operation, keyed by tool name', () => {
    const relationTools = (relation: string) => [
      `list_${relation}`,
      `get_${relation}`,
      `create_${relation}`,
      `update_${relation}`,
      `delete_${relation}`,
    ]
    expect(Object.keys(tools).sort()).toEqual(
      [
        ...relationTools('tasks'),
        ...relationTools('task_tags'),
        ...relationTools('open_tasks'),
        ...relationTools('notes'),
        'list_audit_log',
        'create_audit_log',
        'task_summary',
        'complete_task',
      ].sort(),
    )
    for (const [key, tool] of Object.entries(tools)) {
      expect(tool.name).toBe(key)
    }
  })

  it('skips the root path and relations without a definition', () => {
    const spec = {
      ...probeSpec,
      paths: { ...probeSpec.paths, '/ghost': { get: {} } },
    }
    const names = Object.keys(generateToolDefinitions(untouched(), spec))
    expect(names).not.toContain('list_ghost')
    expect(names.some((name) => name.endsWith('_'))).toBe(false)
  })

  it('does not generate get_, update_ or delete_ for a relation without a primary key', () => {
    expect(tools.list_audit_log).toBeDefined()
    expect(tools.create_audit_log).toBeDefined()
    expect(tools.get_audit_log).toBeUndefined()
    expect(tools.update_audit_log).toBeUndefined()
    expect(tools.delete_audit_log).toBeUndefined()
  })

  it('requires every primary-key column for a composite key', () => {
    for (const name of [
      'get_task_tags',
      'update_task_tags',
      'delete_task_tags',
    ]) {
      expect(tools[name].inputSchema.required).toEqual(['task_id', 'tag'])
    }
    expect(Object.keys(properties(tools.get_task_tags))).toEqual([
      'task_id',
      'tag',
    ])
    expect(Object.keys(properties(tools.delete_task_tags))).toEqual([
      'task_id',
      'tag',
    ])
    // update_ takes every column; only the key is required.
    expect(Object.keys(properties(tools.update_task_tags))).toEqual([
      'task_id',
      'tag',
    ])
    expect(Object.keys(properties(tools.update_tasks))).toEqual([
      'id',
      'owner_id',
      'title',
      'notes',
      'done',
      'created_at',
    ])
    expect(tools.update_tasks.inputSchema.required).toEqual(['id'])
  })

  it('excludes primary keys and columns with a default from create_ required', () => {
    // required in the description is the NOT NULL list: id, owner_id, title,
    // done, created_at. id is the identity key; owner_id, done and created_at
    // carry defaults.
    expect(tools.create_tasks.inputSchema.required).toEqual(['title'])
    expect(Object.keys(properties(tools.create_tasks))).toHaveLength(6)
    expect(tools.create_audit_log.inputSchema.required).toEqual(['message'])
    // A composite key with nothing else leaves no required column at all.
    expect(tools.create_task_tags.inputSchema.required).toBeUndefined()
  })

  it('gives list_ an equality filter per scalar column plus order, limit and offset', () => {
    const list = properties(tools.list_tasks)
    expect(Object.keys(list)).toEqual([
      'id',
      'owner_id',
      'title',
      'notes',
      'done',
      'created_at',
      'order',
      'limit',
      'offset',
    ])
    expect(list.limit).toMatchObject({
      type: 'integer',
      minimum: 1,
      maximum: 1000,
    })
    expect(list.offset).toMatchObject({ type: 'integer', minimum: 0 })
    expect(list.order.description).toContain('created_at')
    expect(tools.list_tasks.inputSchema.required).toBeUndefined()
    expect(tools.list_tasks.inputSchema.additionalProperties).toBe(false)
  })

  it('shadows a column named like a pagination argument', () => {
    const spec = {
      ...probeSpec,
      paths: { '/reports': { get: {} } },
      definitions: {
        reports: {
          properties: {
            limit: { type: 'integer', format: 'int64' },
            title: { type: 'string', format: 'text' },
          },
        },
      },
    }
    const { list_reports } = generateToolDefinitions(untouched(), spec)

    // The pagination argument wins, so the column cannot be filtered on.
    expect(properties(list_reports).limit).toMatchObject({
      description: 'Maximum number of rows to return. Default 100.',
      maximum: 1000,
    })
  })
})

describe('generateToolDefinitions - descriptions and schemas', () => {
  const tools = generateToolDefinitions(untouched(), probeSpec)

  it('takes descriptions from comments and falls back to the operation otherwise', () => {
    expect(tools.list_tasks.description).toBe(
      'A user\'s to-do items. Lists rows of "tasks". Each column argument is an equality filter; combine with order, limit and offset.',
    )
    expect(tools.get_tasks.description).toBe(
      'A user\'s to-do items. Fetches one row of "tasks" by primary key.',
    )
    expect(tools.list_task_tags.description).toBe(
      'Lists rows of "task_tags". Each column argument is an equality filter; combine with order, limit and offset.',
    )
    expect(properties(tools.create_tasks).title.description).toContain(
      'Short label shown in the list.',
    )
    expect(tools.task_summary.description).toBe(
      'Tasks filtered by completion state, scoped to the caller.',
    )
    expect(tools.complete_task.description).toBe(
      'Calls the database function "complete_task".',
    )
  })

  it('moves format and default into the description, never into schema keywords', () => {
    const tasks = properties(tools.create_tasks)
    expect(tasks.id).toEqual({
      type: 'integer',
      description: 'Postgres type: int64.',
    })
    expect(tasks.owner_id).toEqual({
      type: 'string',
      description: 'Postgres type: uuid. Default: auth.uid().',
    })
    expect(tasks.done).toEqual({
      type: 'boolean',
      description: 'Postgres type: boolean. Default: false.',
    })
    for (const tool of Object.values(tools)) {
      for (const property of Object.values(properties(tool))) {
        expect(property).not.toHaveProperty('format')
        expect(property).not.toHaveProperty('default')
      }
    }
  })

  it('does not hard-code the set of format values', () => {
    // The same bigint column reports `int64` on one PostgREST version and
    // `bigint` on another.
    const spec = {
      ...probeSpec,
      paths: { '/things': { get: {} } },
      definitions: {
        things: {
          properties: { amount: { type: 'integer', format: 'bigint' } },
        },
      },
    }
    const { list_things } = generateToolDefinitions(untouched(), spec)
    expect(properties(list_things).amount).toEqual({
      type: 'integer',
      description: 'Postgres type: bigint.',
    })
  })

  it('drops the primary-key markup but keeps the foreign-key note', () => {
    expect(properties(tools.get_task_tags).task_id.description).toBe(
      'This is a Foreign Key to `tasks.id`. Postgres type: int64.',
    )
    expect(properties(tools.get_task_tags).tag.description).toBe(
      'Postgres type: text.',
    )
  })

  it('takes function arguments from the POST body schema', () => {
    expect(tools.task_summary.inputSchema).toEqual({
      type: 'object',
      properties: {
        p_done: { type: 'boolean', description: 'Postgres type: boolean.' },
      },
      additionalProperties: false,
    })
    expect(tools.complete_task.inputSchema).toEqual({
      type: 'object',
      properties: {
        p_id: { type: 'integer', description: 'Postgres type: int64.' },
      },
      required: ['p_id'],
      additionalProperties: false,
    })
  })

  it('annotates each operation per the design table', () => {
    expect(tools.list_tasks.annotations).toEqual(READ_ONLY)
    expect(tools.get_tasks.annotations).toEqual(READ_ONLY)
    expect(tools.create_tasks.annotations).toEqual({
      readOnlyHint: false,
      destructiveHint: false,
      idempotentHint: false,
      openWorldHint: false,
    })
    expect(tools.update_tasks.annotations).toEqual({
      readOnlyHint: false,
      destructiveHint: true,
      idempotentHint: false,
      openWorldHint: false,
    })
    expect(tools.delete_tasks.annotations).toEqual({
      readOnlyHint: false,
      destructiveHint: true,
      idempotentHint: true,
      openWorldHint: false,
    })
    // STABLE → PostgREST exposes GET → read-only.
    expect(tools.task_summary.annotations).toEqual(READ_ONLY)
    // VOLATILE → POST only → conservative, and the only openWorldHint: true.
    expect(tools.complete_task.annotations).toEqual({
      readOnlyHint: false,
      destructiveHint: true,
      idempotentHint: false,
      openWorldHint: true,
    })
    const openWorld = Object.values(tools).filter(
      (tool) => tool.annotations.openWorldHint,
    )
    expect(openWorld.map((tool) => tool.name)).toEqual(['complete_task'])
  })

  it('records provenance in _meta on every tool', () => {
    expect(tools.list_tasks._meta).toEqual({
      kind: 'relation',
      name: 'tasks',
      method: 'GET',
    })
    expect(tools.create_tasks._meta).toEqual({
      kind: 'relation',
      name: 'tasks',
      method: 'POST',
    })
    expect(tools.update_tasks._meta).toEqual({
      kind: 'relation',
      name: 'tasks',
      method: 'PATCH',
    })
    expect(tools.delete_tasks._meta).toEqual({
      kind: 'relation',
      name: 'tasks',
      method: 'DELETE',
    })
    expect(tools.task_summary._meta).toEqual({
      kind: 'function',
      name: 'task_summary',
      method: 'GET',
    })
    expect(tools.complete_task._meta).toEqual({
      kind: 'function',
      name: 'complete_task',
      method: 'POST',
    })
    for (const tool of Object.values(tools)) {
      expect(['relation', 'function']).toContain(tool._meta.kind)
    }
  })

  it('fails with TOOL_NAME_COLLISION instead of overwriting a tool', () => {
    let caught: unknown
    try {
      generateToolDefinitions(untouched(), probeSpecWithCollision)
    } catch (error) {
      caught = error
    }
    expect(caught).toBeInstanceOf(ToolGenerationError)
    const error = caught as ToolGenerationError
    expect(error.code).toBe(ToolNameCollisionError)
    expect(error.status).toBe(500)
    expect(error.message).toContain('"list_tasks"')
    expect(error.details).toEqual({
      name: 'list_tasks',
      operations: ['relation "tasks" (GET)', 'function "list_tasks" (GET)'],
    })
    expect(error.hint).toContain('Rename the database function')
  })

  it('emits input schemas the MCP SDK accepts as they are', async () => {
    for (const tool of Object.values(tools)) {
      const schema = fromJsonSchema(tool.inputSchema as never)
      expect(
        schema['~standard'].jsonSchema.input({ target: 'draft-2020-12' }),
      ).toEqual(tool.inputSchema)
    }
    const list = fromJsonSchema(tools.list_tasks.inputSchema as never)
    expect(await list['~standard'].validate({ limit: 'ten' })).toHaveProperty(
      'issues',
    )
    expect(await list['~standard'].validate({ done: true, limit: 5 })).toEqual({
      value: { done: true, limit: 5 },
    })
    expect(
      await list['~standard'].validate({ unknown_column: 1 }),
    ).toHaveProperty('issues')
  })
})

describe('generateToolDefinitions - execution through the caller-scoped client', () => {
  const rows = [{ id: 1, title: 'Buy milk' }]

  it('list_ selects everything with the default page and forwards the caller token', async () => {
    const { client, calls } = recordingClient([{ body: rows }])
    const tools = generateToolDefinitions(client, probeSpec)

    const result = await tools.list_tasks.handler({})

    expect(result).toEqual(text(rows))
    expect(calls).toHaveLength(1)
    const [call] = calls
    expect(call.method).toBe('GET')
    // The client's URL, never the `host` from the description (0.0.0.0:3000).
    expect(call.url.origin).toBe(PROJECT_URL)
    expect(call.url.pathname).toBe('/rest/v1/tasks')
    expect(Object.fromEntries(call.url.searchParams)).toEqual({
      select: '*',
      offset: '0',
      limit: '100',
    })
    expect(call.headers.get('authorization')).toBe('Bearer user-jwt')
    expect(call.headers.get('apikey')).toBe(PUBLISHABLE_KEY)
  })

  it('list_ turns arguments into equality filters, order and a range', async () => {
    const { client, calls } = recordingClient()
    const tools = generateToolDefinitions(client, probeSpec)

    await tools.list_tasks.handler({
      done: false,
      title: 'x',
      order: 'created_at.desc',
      limit: 10,
      offset: 20,
    })

    expect(Object.fromEntries(calls[0].url.searchParams)).toEqual({
      select: '*',
      done: 'eq.false',
      title: 'eq.x',
      order: 'created_at.desc',
      offset: '20',
      limit: '10',
    })
  })

  it('list_ orders ascending by default and leaves the column to PostgREST', async () => {
    const { client, calls } = recordingClient()
    const tools = generateToolDefinitions(client, probeSpec)

    await tools.list_tasks.handler({ order: 'title' })
    expect(calls[0].url.searchParams.get('order')).toBe('title.asc')

    // No local column list to keep in step: PostgREST answers a column it
    // cannot find with a 400, which the handler reports as a tool error.
    await tools.list_tasks.handler({ order: 'nope' })
    expect(calls[1].url.searchParams.get('order')).toBe('nope.asc')
  })

  it('get_ matches on the primary key and reports a missing row', async () => {
    const { client, calls } = recordingClient([{ body: rows }, { body: [] }])
    const tools = generateToolDefinitions(client, probeSpec)

    expect(await tools.get_tasks.handler({ id: 1 })).toEqual(text(rows[0]))
    expect(calls[0].url.searchParams.get('id')).toBe('eq.1')

    await expect(tools.get_tasks.handler({ id: 2 })).rejects.toThrow(
      'No row of "tasks" matches {"id":2}.',
    )
  })

  it('get_ on a composite key sends every key column', async () => {
    const { client, calls } = recordingClient([
      { body: [{ task_id: 1, tag: 'x' }] },
    ])
    const tools = generateToolDefinitions(client, probeSpec)

    await tools.get_task_tags.handler({ task_id: 1, tag: 'x' })

    expect(Object.fromEntries(calls[0].url.searchParams)).toEqual({
      select: '*',
      task_id: 'eq.1',
      tag: 'eq.x',
    })
  })

  it('create_ posts the row and returns the representation', async () => {
    const { client, calls } = recordingClient([{ status: 201, body: rows[0] }])
    const tools = generateToolDefinitions(client, probeSpec)

    expect(await tools.create_tasks.handler({ title: 'Buy milk' })).toEqual(
      text(rows[0]),
    )
    const [call] = calls
    expect(call.method).toBe('POST')
    expect(call.url.pathname).toBe('/rest/v1/tasks')
    expect(call.body).toEqual({ title: 'Buy milk' })
    expect(call.url.searchParams.get('select')).toBe('*')
    expect(call.headers.get('prefer')).toContain('return=representation')
  })

  it('update_ patches only the non-key columns and refuses an empty change', async () => {
    const { client, calls } = recordingClient([{ body: { id: 1, done: true } }])
    const tools = generateToolDefinitions(client, probeSpec)

    expect(await tools.update_tasks.handler({ id: 1, done: true })).toEqual(
      text({ id: 1, done: true }),
    )
    const [call] = calls
    expect(call.method).toBe('PATCH')
    expect(call.body).toEqual({ done: true })
    expect(call.url.searchParams.get('id')).toBe('eq.1')

    await expect(tools.update_tasks.handler({ id: 1 })).rejects.toThrow(
      /Nothing to update in "tasks"/,
    )
    expect(calls).toHaveLength(1)
  })

  it('delete_ deletes by primary key and returns the deleted row', async () => {
    const { client, calls } = recordingClient([{ body: rows[0] }])
    const tools = generateToolDefinitions(client, probeSpec)

    expect(await tools.delete_tasks.handler({ id: 1 })).toEqual(text(rows[0]))
    const [call] = calls
    expect(call.method).toBe('DELETE')
    expect(call.url.searchParams.get('id')).toBe('eq.1')
    expect(call.url.searchParams.get('select')).toBe('*')
  })

  it('calls GET-capable functions with GET and the rest with POST', async () => {
    const { client, calls } = recordingClient([
      { body: rows },
      { body: rows[0] },
    ])
    const tools = generateToolDefinitions(client, probeSpec)

    await tools.task_summary.handler({ p_done: true })
    expect(calls[0].method).toBe('GET')
    expect(calls[0].url.pathname).toBe('/rest/v1/rpc/task_summary')
    expect(calls[0].url.searchParams.get('p_done')).toBe('true')

    await tools.complete_task.handler({ p_id: 1 })
    expect(calls[1].method).toBe('POST')
    expect(calls[1].url.pathname).toBe('/rest/v1/rpc/complete_task')
    expect(calls[1].body).toEqual({ p_id: 1 })
  })

  it('throws what PostgREST said so the SDK reports a tool error', async () => {
    const { client } = recordingClient([
      {
        status: 403,
        body: {
          code: '42501',
          message: 'permission denied for table tasks',
          details: null,
          hint: null,
        },
      },
    ])
    const tools = generateToolDefinitions(client, probeSpec)

    await expect(tools.create_tasks.handler({ title: 'x' })).rejects.toThrow(
      'permission denied for table tasks (42501)',
    )
  })
})

describe('fetchSpec', () => {
  const clientReturning = (response: unknown): SupabaseClient =>
    ({ getOpenApiSpec: async () => response }) as unknown as SupabaseClient

  const failure = async (
    promise: Promise<unknown>,
  ): Promise<ToolGenerationError> => {
    try {
      await promise
    } catch (error) {
      expect(error).toBeInstanceOf(ToolGenerationError)
      return error as ToolGenerationError
    }
    throw new Error('expected a rejection')
  }

  it('delegates to supabase-js and returns the document', async () => {
    const client = clientReturning({
      data: probeSpec,
      error: null,
      status: 200,
    })
    expect(await fetchSpec(client)).toBe(probeSpec)
    // generateTools is the two steps composed.
    const tools = await generateTools(client)
    expect(Object.keys(tools)).toContain('list_tasks')
  })

  it.each([
    [404, /OpenAPI output is disabled/],
    [406, /OpenAPI output is disabled/],
    [401, /rejected the credentials/],
    [403, /rejected the credentials/],
    [0, /never reached PostgREST/],
    [500, /healthy Data API/],
  ])(
    'maps a PostgREST failure with status %i to SPEC_FETCH_FAILED',
    async (status, hint) => {
      const postgrestError = {
        message: 'nope',
        details: '',
        hint: '',
        code: 'X',
      }
      const error = await failure(
        fetchSpec(
          clientReturning({ data: null, error: postgrestError, status }),
        ),
      )
      expect(error.code).toBe(SpecFetchFailedError)
      expect(error.status).toBe(500)
      expect(error.message).toContain(`(HTTP ${status}): nope`)
      expect(error.hint).toMatch(hint)
      expect(error.details).toEqual({ status })
      expect(error.cause).toBe(postgrestError)
    },
  )

  it('rejects a body that is not a Swagger 2.0 document with definitions', async () => {
    const error = await failure(
      fetchSpec(
        clientReturning({
          data: { openapi: '3.0.0', paths: {} },
          error: null,
          status: 200,
        }),
      ),
    )
    expect(error.code).toBe(SpecFetchFailedError)
    expect(error.message).toContain('not a Swagger 2.0 document')
    expect(error.details).toEqual({ status: 200 })
  })

  it('tells older supabase-js clients to upgrade', async () => {
    const error = await failure(fetchSpec({} as unknown as SupabaseClient))
    expect(error.code).toBe(SpecFetchFailedError)
    expect(error.hint).toContain('2.115.0')
  })

  it('ignores the paths a caller removes from the document', async () => {
    const spec = withoutPaths(probeSpec, '/tasks', '/rpc/task_summary')
    const tools = generateToolDefinitions(untouched(), spec)
    expect(tools.list_tasks).toBeUndefined()
    expect(tools.task_summary).toBeUndefined()
    expect(tools.list_notes).toBeDefined()
  })
})
