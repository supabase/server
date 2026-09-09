import {
  McpServer,
  type StandardSchemaWithJSON,
  type ToolAnnotations,
} from '@modelcontextprotocol/server'
import { createClient } from '@supabase/supabase-js'
import { describe, expect, it, vi } from 'vitest'

import { probeSpec } from './__fixtures__/probe-spec.js'
import { generateToolDefinitions } from './generate.js'
import { registerTools } from './register.js'
import type { GeneratedTool } from './types.js'

const client = createClient(
  'https://project.supabase.co',
  'sb_publishable_test',
)
const tools = generateToolDefinitions(client, probeSpec)

/** What `registerTools` hands to `server.registerTool`, as the SDK sees it. */
interface RegisteredConfig {
  description?: string
  annotations?: ToolAnnotations
  inputSchema?: StandardSchemaWithJSON
}
type Registration = [
  name: string,
  config: RegisteredConfig,
  callback: (args: unknown, ctx: unknown) => unknown,
]

/** Records registerTool calls without running an MCP transport. */
function recordingServer() {
  const registerTool = vi.fn()
  return {
    server: { registerTool } as unknown as Pick<McpServer, 'registerTool'>,
    calls: registerTool.mock.calls as unknown as Registration[],
  }
}

describe('registerTools - what reaches the SDK', () => {
  it('registers every tool under its own name', () => {
    const { server, calls } = recordingServer()
    registerTools(server, tools)
    expect(calls.map(([name]) => name).sort()).toEqual(
      Object.keys(tools).sort(),
    )
  })

  it('forwards description and annotations, strips _meta, and wraps the schema', () => {
    const { server, calls } = recordingServer()
    registerTools(server, { list_tasks: tools.list_tasks })

    const [, config] = calls[0]
    expect(config.description).toBe(tools.list_tasks.description)
    expect(config.annotations).toEqual(tools.list_tasks.annotations)
    expect(config).not.toHaveProperty('_meta')
    expect(config).not.toHaveProperty('handler')
    expect(config).not.toHaveProperty('name')
    // The SDK's fromJsonSchema wrapper advertises the same JSON Schema.
    const schema = config.inputSchema!
    expect(
      schema['~standard'].jsonSchema.input({ target: 'draft-2020-12' }),
    ).toEqual(tools.list_tasks.inputSchema)
  })

  it('validates arguments through the SDK before the handler runs', async () => {
    const { server, calls } = recordingServer()
    registerTools(server, { list_tasks: tools.list_tasks })

    const schema = calls[0][1].inputSchema!
    expect(await schema['~standard'].validate({ limit: 'ten' })).toHaveProperty(
      'issues',
    )
    expect(await schema['~standard'].validate({ done: true })).toEqual({
      value: { done: true },
    })
  })

  it('hands arguments to the generated handler', async () => {
    const { server, calls } = recordingServer()
    const handler = vi.fn(async (args: Record<string, unknown>) => ({
      content: [{ type: 'text' as const, text: JSON.stringify(args) }],
    }))
    const tool: GeneratedTool = { ...tools.get_tasks, handler }
    registerTools(server, { get_tasks: tool })

    const [, , callback] = calls[0]
    const result = await callback({ id: 7 }, {})

    expect(handler).toHaveBeenCalledWith({ id: 7 })
    expect(result).toEqual({ content: [{ type: 'text', text: '{"id":7}' }] })
  })

  it('registers whatever subset it is given, so filtering is plain JavaScript', () => {
    const { server, calls } = recordingServer()
    const functionTools = Object.fromEntries(
      Object.entries(tools).filter(
        ([, tool]) => tool._meta.kind === 'function',
      ),
    )
    registerTools(server, functionTools)
    expect(calls.map(([name]) => name).sort()).toEqual([
      'complete_task',
      'task_summary',
    ])
  })
})

describe('registerTools - against a real McpServer', () => {
  it('registers the whole generated set', () => {
    const server = new McpServer({ name: 'test', version: '0.0.0' })
    expect(() => registerTools(server, tools)).not.toThrow()
  })

  it("surfaces the SDK's own error for a name that is already registered", () => {
    const server = new McpServer({ name: 'test', version: '0.0.0' })
    registerTools(server, { list_tasks: tools.list_tasks })
    expect(() =>
      registerTools(server, { list_tasks: tools.list_tasks }),
    ).toThrow(/already registered/)
  })
})
