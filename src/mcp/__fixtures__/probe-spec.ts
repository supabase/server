// Swagger 2.0 document captured from PostgREST 16.1 in the e2e stack
// (Supabase CLI 2.115.0) as the `authenticated` role, with the probe schema in
// e2e/supabase/migrations/20260102000000_mcp_probe.sql applied. Shapes here
// were read off a running PostgREST, not inferred. Regenerate with:
//
//   (cd e2e && supabase start) && pnpm gen:env
//   set -a && . ./e2e/.env && set +a && TOKEN=$(node e2e/scripts/get-token.ts)
//   curl -s "$SUPABASE_URL/rest/v1/" -H "apikey: $SUPABASE_PUBLISHABLE_KEY" \
//     -H "Authorization: Bearer $TOKEN" -H "Accept: application/openapi+json"
//
// then paste the JSON into `probeSpecWithCollision` and run prettier.
import type { PostgrestOpenApiSpec } from '@supabase/supabase-js'

/**
 * The raw capture. It includes the database function `list_tasks`, whose tool
 * name collides with the generated `list_tasks` for the `tasks` table.
 */
export const probeSpecWithCollision: PostgrestOpenApiSpec = {
  swagger: '2.0',
  info: {
    description: '',
    title: 'standard public schema',
    version: '16.1',
  },
  host: '0.0.0.0:3000',
  basePath: '/',
  schemes: ['http'],
  consumes: [
    'application/json',
    'application/vnd.pgrst.object+json;nulls=stripped',
    'application/vnd.pgrst.object+json',
    'text/csv',
  ],
  produces: [
    'application/json',
    'application/vnd.pgrst.object+json;nulls=stripped',
    'application/vnd.pgrst.object+json',
    'text/csv',
  ],
  paths: {
    '/': {
      get: {
        produces: ['application/openapi+json', 'application/json'],
        responses: {
          '200': {
            description: 'OK',
          },
        },
        summary: 'OpenAPI description (this document)',
        tags: ['Introspection'],
      },
    },
    '/open_tasks': {
      get: {
        parameters: [
          {
            $ref: '#/parameters/rowFilter.open_tasks.id',
          },
          {
            $ref: '#/parameters/rowFilter.open_tasks.title',
          },
          {
            $ref: '#/parameters/rowFilter.open_tasks.created_at',
          },
          {
            $ref: '#/parameters/select',
          },
          {
            $ref: '#/parameters/order',
          },
          {
            $ref: '#/parameters/range',
          },
          {
            $ref: '#/parameters/rangeUnit',
          },
          {
            $ref: '#/parameters/offset',
          },
          {
            $ref: '#/parameters/limit',
          },
          {
            $ref: '#/parameters/preferCount',
          },
        ],
        responses: {
          '200': {
            description: 'OK',
            schema: {
              items: {
                $ref: '#/definitions/open_tasks',
              },
              type: 'array',
            },
          },
          '206': {
            description: 'Partial Content',
          },
        },
        tags: ['open_tasks'],
      },
      post: {
        parameters: [
          {
            $ref: '#/parameters/body.open_tasks',
          },
          {
            $ref: '#/parameters/select',
          },
          {
            $ref: '#/parameters/preferPost',
          },
        ],
        responses: {
          '201': {
            description: 'Created',
          },
        },
        tags: ['open_tasks'],
      },
      delete: {
        parameters: [
          {
            $ref: '#/parameters/rowFilter.open_tasks.id',
          },
          {
            $ref: '#/parameters/rowFilter.open_tasks.title',
          },
          {
            $ref: '#/parameters/rowFilter.open_tasks.created_at',
          },
          {
            $ref: '#/parameters/preferReturn',
          },
        ],
        responses: {
          '204': {
            description: 'No Content',
          },
        },
        tags: ['open_tasks'],
      },
      patch: {
        parameters: [
          {
            $ref: '#/parameters/rowFilter.open_tasks.id',
          },
          {
            $ref: '#/parameters/rowFilter.open_tasks.title',
          },
          {
            $ref: '#/parameters/rowFilter.open_tasks.created_at',
          },
          {
            $ref: '#/parameters/body.open_tasks',
          },
          {
            $ref: '#/parameters/preferReturn',
          },
        ],
        responses: {
          '204': {
            description: 'No Content',
          },
        },
        tags: ['open_tasks'],
      },
    },
    '/audit_log': {
      get: {
        parameters: [
          {
            $ref: '#/parameters/rowFilter.audit_log.occurred_at',
          },
          {
            $ref: '#/parameters/rowFilter.audit_log.message',
          },
          {
            $ref: '#/parameters/select',
          },
          {
            $ref: '#/parameters/order',
          },
          {
            $ref: '#/parameters/range',
          },
          {
            $ref: '#/parameters/rangeUnit',
          },
          {
            $ref: '#/parameters/offset',
          },
          {
            $ref: '#/parameters/limit',
          },
          {
            $ref: '#/parameters/preferCount',
          },
        ],
        responses: {
          '200': {
            description: 'OK',
            schema: {
              items: {
                $ref: '#/definitions/audit_log',
              },
              type: 'array',
            },
          },
          '206': {
            description: 'Partial Content',
          },
        },
        tags: ['audit_log'],
      },
      post: {
        parameters: [
          {
            $ref: '#/parameters/body.audit_log',
          },
          {
            $ref: '#/parameters/select',
          },
          {
            $ref: '#/parameters/preferPost',
          },
        ],
        responses: {
          '201': {
            description: 'Created',
          },
        },
        tags: ['audit_log'],
      },
      delete: {
        parameters: [
          {
            $ref: '#/parameters/rowFilter.audit_log.occurred_at',
          },
          {
            $ref: '#/parameters/rowFilter.audit_log.message',
          },
          {
            $ref: '#/parameters/preferReturn',
          },
        ],
        responses: {
          '204': {
            description: 'No Content',
          },
        },
        tags: ['audit_log'],
      },
      patch: {
        parameters: [
          {
            $ref: '#/parameters/rowFilter.audit_log.occurred_at',
          },
          {
            $ref: '#/parameters/rowFilter.audit_log.message',
          },
          {
            $ref: '#/parameters/body.audit_log',
          },
          {
            $ref: '#/parameters/preferReturn',
          },
        ],
        responses: {
          '204': {
            description: 'No Content',
          },
        },
        tags: ['audit_log'],
      },
    },
    '/notes': {
      get: {
        parameters: [
          {
            $ref: '#/parameters/rowFilter.notes.id',
          },
          {
            $ref: '#/parameters/rowFilter.notes.user_id',
          },
          {
            $ref: '#/parameters/rowFilter.notes.body',
          },
          {
            $ref: '#/parameters/rowFilter.notes.created_at',
          },
          {
            $ref: '#/parameters/select',
          },
          {
            $ref: '#/parameters/order',
          },
          {
            $ref: '#/parameters/range',
          },
          {
            $ref: '#/parameters/rangeUnit',
          },
          {
            $ref: '#/parameters/offset',
          },
          {
            $ref: '#/parameters/limit',
          },
          {
            $ref: '#/parameters/preferCount',
          },
        ],
        responses: {
          '200': {
            description: 'OK',
            schema: {
              items: {
                $ref: '#/definitions/notes',
              },
              type: 'array',
            },
          },
          '206': {
            description: 'Partial Content',
          },
        },
        tags: ['notes'],
      },
      post: {
        parameters: [
          {
            $ref: '#/parameters/body.notes',
          },
          {
            $ref: '#/parameters/select',
          },
          {
            $ref: '#/parameters/preferPost',
          },
        ],
        responses: {
          '201': {
            description: 'Created',
          },
        },
        tags: ['notes'],
      },
      delete: {
        parameters: [
          {
            $ref: '#/parameters/rowFilter.notes.id',
          },
          {
            $ref: '#/parameters/rowFilter.notes.user_id',
          },
          {
            $ref: '#/parameters/rowFilter.notes.body',
          },
          {
            $ref: '#/parameters/rowFilter.notes.created_at',
          },
          {
            $ref: '#/parameters/preferReturn',
          },
        ],
        responses: {
          '204': {
            description: 'No Content',
          },
        },
        tags: ['notes'],
      },
      patch: {
        parameters: [
          {
            $ref: '#/parameters/rowFilter.notes.id',
          },
          {
            $ref: '#/parameters/rowFilter.notes.user_id',
          },
          {
            $ref: '#/parameters/rowFilter.notes.body',
          },
          {
            $ref: '#/parameters/rowFilter.notes.created_at',
          },
          {
            $ref: '#/parameters/body.notes',
          },
          {
            $ref: '#/parameters/preferReturn',
          },
        ],
        responses: {
          '204': {
            description: 'No Content',
          },
        },
        tags: ['notes'],
      },
    },
    '/task_tags': {
      get: {
        parameters: [
          {
            $ref: '#/parameters/rowFilter.task_tags.task_id',
          },
          {
            $ref: '#/parameters/rowFilter.task_tags.tag',
          },
          {
            $ref: '#/parameters/select',
          },
          {
            $ref: '#/parameters/order',
          },
          {
            $ref: '#/parameters/range',
          },
          {
            $ref: '#/parameters/rangeUnit',
          },
          {
            $ref: '#/parameters/offset',
          },
          {
            $ref: '#/parameters/limit',
          },
          {
            $ref: '#/parameters/preferCount',
          },
        ],
        responses: {
          '200': {
            description: 'OK',
            schema: {
              items: {
                $ref: '#/definitions/task_tags',
              },
              type: 'array',
            },
          },
          '206': {
            description: 'Partial Content',
          },
        },
        tags: ['task_tags'],
      },
      post: {
        parameters: [
          {
            $ref: '#/parameters/body.task_tags',
          },
          {
            $ref: '#/parameters/select',
          },
          {
            $ref: '#/parameters/preferPost',
          },
        ],
        responses: {
          '201': {
            description: 'Created',
          },
        },
        tags: ['task_tags'],
      },
      delete: {
        parameters: [
          {
            $ref: '#/parameters/rowFilter.task_tags.task_id',
          },
          {
            $ref: '#/parameters/rowFilter.task_tags.tag',
          },
          {
            $ref: '#/parameters/preferReturn',
          },
        ],
        responses: {
          '204': {
            description: 'No Content',
          },
        },
        tags: ['task_tags'],
      },
      patch: {
        parameters: [
          {
            $ref: '#/parameters/rowFilter.task_tags.task_id',
          },
          {
            $ref: '#/parameters/rowFilter.task_tags.tag',
          },
          {
            $ref: '#/parameters/body.task_tags',
          },
          {
            $ref: '#/parameters/preferReturn',
          },
        ],
        responses: {
          '204': {
            description: 'No Content',
          },
        },
        tags: ['task_tags'],
      },
    },
    '/tasks': {
      get: {
        parameters: [
          {
            $ref: '#/parameters/rowFilter.tasks.id',
          },
          {
            $ref: '#/parameters/rowFilter.tasks.owner_id',
          },
          {
            $ref: '#/parameters/rowFilter.tasks.title',
          },
          {
            $ref: '#/parameters/rowFilter.tasks.notes',
          },
          {
            $ref: '#/parameters/rowFilter.tasks.done',
          },
          {
            $ref: '#/parameters/rowFilter.tasks.created_at',
          },
          {
            $ref: '#/parameters/select',
          },
          {
            $ref: '#/parameters/order',
          },
          {
            $ref: '#/parameters/range',
          },
          {
            $ref: '#/parameters/rangeUnit',
          },
          {
            $ref: '#/parameters/offset',
          },
          {
            $ref: '#/parameters/limit',
          },
          {
            $ref: '#/parameters/preferCount',
          },
        ],
        responses: {
          '200': {
            description: 'OK',
            schema: {
              items: {
                $ref: '#/definitions/tasks',
              },
              type: 'array',
            },
          },
          '206': {
            description: 'Partial Content',
          },
        },
        summary: "A user's to-do items.",
        tags: ['tasks'],
      },
      post: {
        parameters: [
          {
            $ref: '#/parameters/body.tasks',
          },
          {
            $ref: '#/parameters/select',
          },
          {
            $ref: '#/parameters/preferPost',
          },
        ],
        responses: {
          '201': {
            description: 'Created',
          },
        },
        summary: "A user's to-do items.",
        tags: ['tasks'],
      },
      delete: {
        parameters: [
          {
            $ref: '#/parameters/rowFilter.tasks.id',
          },
          {
            $ref: '#/parameters/rowFilter.tasks.owner_id',
          },
          {
            $ref: '#/parameters/rowFilter.tasks.title',
          },
          {
            $ref: '#/parameters/rowFilter.tasks.notes',
          },
          {
            $ref: '#/parameters/rowFilter.tasks.done',
          },
          {
            $ref: '#/parameters/rowFilter.tasks.created_at',
          },
          {
            $ref: '#/parameters/preferReturn',
          },
        ],
        responses: {
          '204': {
            description: 'No Content',
          },
        },
        summary: "A user's to-do items.",
        tags: ['tasks'],
      },
      patch: {
        parameters: [
          {
            $ref: '#/parameters/rowFilter.tasks.id',
          },
          {
            $ref: '#/parameters/rowFilter.tasks.owner_id',
          },
          {
            $ref: '#/parameters/rowFilter.tasks.title',
          },
          {
            $ref: '#/parameters/rowFilter.tasks.notes',
          },
          {
            $ref: '#/parameters/rowFilter.tasks.done',
          },
          {
            $ref: '#/parameters/rowFilter.tasks.created_at',
          },
          {
            $ref: '#/parameters/body.tasks',
          },
          {
            $ref: '#/parameters/preferReturn',
          },
        ],
        responses: {
          '204': {
            description: 'No Content',
          },
        },
        summary: "A user's to-do items.",
        tags: ['tasks'],
      },
    },
    '/rpc/task_summary': {
      get: {
        parameters: [
          {
            format: 'boolean',
            in: 'query',
            name: 'p_done',
            required: false,
            type: 'boolean',
          },
        ],
        produces: [
          'application/json',
          'application/vnd.pgrst.object+json;nulls=stripped',
          'application/vnd.pgrst.object+json',
        ],
        responses: {
          '200': {
            description: 'OK',
          },
        },
        summary: 'Tasks filtered by completion state, scoped to the caller.',
        tags: ['(rpc) task_summary'],
      },
      post: {
        parameters: [
          {
            in: 'body',
            name: 'args',
            required: true,
            schema: {
              description:
                'Tasks filtered by completion state, scoped to the caller.',
              properties: {
                p_done: {
                  format: 'boolean',
                  type: 'boolean',
                },
              },
              type: 'object',
            },
          },
          {
            $ref: '#/parameters/preferParams',
          },
        ],
        produces: [
          'application/json',
          'application/vnd.pgrst.object+json;nulls=stripped',
          'application/vnd.pgrst.object+json',
        ],
        responses: {
          '200': {
            description: 'OK',
          },
        },
        summary: 'Tasks filtered by completion state, scoped to the caller.',
        tags: ['(rpc) task_summary'],
      },
    },
    '/rpc/list_tasks': {
      get: {
        produces: [
          'application/json',
          'application/vnd.pgrst.object+json;nulls=stripped',
          'application/vnd.pgrst.object+json',
        ],
        responses: {
          '200': {
            description: 'OK',
          },
        },
        tags: ['(rpc) list_tasks'],
      },
      post: {
        parameters: [
          {
            in: 'body',
            name: 'args',
            required: true,
            schema: {
              type: 'object',
            },
          },
          {
            $ref: '#/parameters/preferParams',
          },
        ],
        produces: [
          'application/json',
          'application/vnd.pgrst.object+json;nulls=stripped',
          'application/vnd.pgrst.object+json',
        ],
        responses: {
          '200': {
            description: 'OK',
          },
        },
        tags: ['(rpc) list_tasks'],
      },
    },
    '/rpc/complete_task': {
      post: {
        parameters: [
          {
            in: 'body',
            name: 'args',
            required: true,
            schema: {
              properties: {
                p_id: {
                  format: 'int64',
                  type: 'integer',
                },
              },
              required: ['p_id'],
              type: 'object',
            },
          },
          {
            $ref: '#/parameters/preferParams',
          },
        ],
        produces: [
          'application/json',
          'application/vnd.pgrst.object+json;nulls=stripped',
          'application/vnd.pgrst.object+json',
        ],
        responses: {
          '200': {
            description: 'OK',
          },
        },
        tags: ['(rpc) complete_task'],
      },
    },
  },
  definitions: {
    open_tasks: {
      properties: {
        id: {
          description: 'Note:\nThis is a Primary Key.<pk/>',
          format: 'int64',
          type: 'integer',
        },
        title: {
          format: 'text',
          type: 'string',
        },
        created_at: {
          format: 'timestamp with time zone',
          type: 'string',
        },
      },
      type: 'object',
    },
    audit_log: {
      required: ['occurred_at', 'message'],
      properties: {
        occurred_at: {
          default: 'now()',
          format: 'timestamp with time zone',
          type: 'string',
        },
        message: {
          format: 'text',
          type: 'string',
        },
      },
      type: 'object',
    },
    notes: {
      required: ['id', 'user_id', 'body', 'created_at'],
      properties: {
        id: {
          default: 'gen_random_uuid()',
          description: 'Note:\nThis is a Primary Key.<pk/>',
          format: 'uuid',
          type: 'string',
        },
        user_id: {
          format: 'uuid',
          type: 'string',
        },
        body: {
          format: 'text',
          type: 'string',
        },
        created_at: {
          default: 'now()',
          format: 'timestamp with time zone',
          type: 'string',
        },
      },
      type: 'object',
    },
    task_tags: {
      required: ['task_id', 'tag'],
      properties: {
        task_id: {
          description:
            "Note:\nThis is a Primary Key.<pk/>\nThis is a Foreign Key to `tasks.id`.<fk table='tasks' column='id'/>",
          format: 'int64',
          type: 'integer',
        },
        tag: {
          description: 'Note:\nThis is a Primary Key.<pk/>',
          format: 'text',
          type: 'string',
        },
      },
      type: 'object',
    },
    tasks: {
      description: "A user's to-do items.",
      required: ['id', 'owner_id', 'title', 'done', 'created_at'],
      properties: {
        id: {
          description: 'Note:\nThis is a Primary Key.<pk/>',
          format: 'int64',
          type: 'integer',
        },
        owner_id: {
          default: 'auth.uid()',
          format: 'uuid',
          type: 'string',
        },
        title: {
          description: 'Short label shown in the list.',
          format: 'text',
          type: 'string',
        },
        notes: {
          format: 'text',
          type: 'string',
        },
        done: {
          default: false,
          format: 'boolean',
          type: 'boolean',
        },
        created_at: {
          default: 'now()',
          format: 'timestamp with time zone',
          type: 'string',
        },
      },
      type: 'object',
    },
  },
  parameters: {
    preferParams: {
      name: 'Prefer',
      description: 'Preference',
      required: false,
      in: 'header',
      type: 'string',
    },
    preferReturn: {
      name: 'Prefer',
      description: 'Preference',
      required: false,
      enum: ['return=representation', 'return=minimal', 'return=none'],
      in: 'header',
      type: 'string',
    },
    preferCount: {
      name: 'Prefer',
      description: 'Preference',
      required: false,
      enum: ['count=none'],
      in: 'header',
      type: 'string',
    },
    preferPost: {
      name: 'Prefer',
      description: 'Preference',
      required: false,
      enum: [
        'return=representation',
        'return=minimal',
        'return=none',
        'resolution=ignore-duplicates',
        'resolution=merge-duplicates',
      ],
      in: 'header',
      type: 'string',
    },
    select: {
      name: 'select',
      description: 'Filtering Columns',
      required: false,
      in: 'query',
      type: 'string',
    },
    on_conflict: {
      name: 'on_conflict',
      description: 'On Conflict',
      required: false,
      in: 'query',
      type: 'string',
    },
    order: {
      name: 'order',
      description: 'Ordering',
      required: false,
      in: 'query',
      type: 'string',
    },
    range: {
      name: 'Range',
      description: 'Limiting and Pagination',
      required: false,
      in: 'header',
      type: 'string',
    },
    rangeUnit: {
      name: 'Range-Unit',
      description: 'Limiting and Pagination',
      required: false,
      default: 'items',
      in: 'header',
      type: 'string',
    },
    offset: {
      name: 'offset',
      description: 'Limiting and Pagination',
      required: false,
      in: 'query',
      type: 'string',
    },
    limit: {
      name: 'limit',
      description: 'Limiting and Pagination',
      required: false,
      in: 'query',
      type: 'string',
    },
    'body.open_tasks': {
      name: 'open_tasks',
      description: 'open_tasks',
      required: false,
      in: 'body',
      schema: {
        $ref: '#/definitions/open_tasks',
      },
    },
    'rowFilter.open_tasks.id': {
      name: 'id',
      required: false,
      in: 'query',
      type: 'string',
    },
    'rowFilter.open_tasks.title': {
      name: 'title',
      required: false,
      in: 'query',
      type: 'string',
    },
    'rowFilter.open_tasks.created_at': {
      name: 'created_at',
      required: false,
      in: 'query',
      type: 'string',
    },
    'body.audit_log': {
      name: 'audit_log',
      description: 'audit_log',
      required: false,
      in: 'body',
      schema: {
        $ref: '#/definitions/audit_log',
      },
    },
    'rowFilter.audit_log.occurred_at': {
      name: 'occurred_at',
      required: false,
      in: 'query',
      type: 'string',
    },
    'rowFilter.audit_log.message': {
      name: 'message',
      required: false,
      in: 'query',
      type: 'string',
    },
    'body.notes': {
      name: 'notes',
      description: 'notes',
      required: false,
      in: 'body',
      schema: {
        $ref: '#/definitions/notes',
      },
    },
    'rowFilter.notes.id': {
      name: 'id',
      required: false,
      in: 'query',
      type: 'string',
    },
    'rowFilter.notes.user_id': {
      name: 'user_id',
      required: false,
      in: 'query',
      type: 'string',
    },
    'rowFilter.notes.body': {
      name: 'body',
      required: false,
      in: 'query',
      type: 'string',
    },
    'rowFilter.notes.created_at': {
      name: 'created_at',
      required: false,
      in: 'query',
      type: 'string',
    },
    'body.task_tags': {
      name: 'task_tags',
      description: 'task_tags',
      required: false,
      in: 'body',
      schema: {
        $ref: '#/definitions/task_tags',
      },
    },
    'rowFilter.task_tags.task_id': {
      name: 'task_id',
      required: false,
      in: 'query',
      type: 'string',
    },
    'rowFilter.task_tags.tag': {
      name: 'tag',
      required: false,
      in: 'query',
      type: 'string',
    },
    'body.tasks': {
      name: 'tasks',
      description: 'tasks',
      required: false,
      in: 'body',
      schema: {
        $ref: '#/definitions/tasks',
      },
    },
    'rowFilter.tasks.id': {
      name: 'id',
      required: false,
      in: 'query',
      type: 'string',
    },
    'rowFilter.tasks.owner_id': {
      name: 'owner_id',
      required: false,
      in: 'query',
      type: 'string',
    },
    'rowFilter.tasks.title': {
      name: 'title',
      description: 'Short label shown in the list.',
      required: false,
      in: 'query',
      type: 'string',
    },
    'rowFilter.tasks.notes': {
      name: 'notes',
      required: false,
      in: 'query',
      type: 'string',
    },
    'rowFilter.tasks.done': {
      name: 'done',
      required: false,
      in: 'query',
      type: 'string',
    },
    'rowFilter.tasks.created_at': {
      name: 'created_at',
      required: false,
      in: 'query',
      type: 'string',
    },
  },
  externalDocs: {
    description: 'PostgREST Documentation',
    url: 'https://postgrest.org/en/v16/references/api.html',
  },
}

/** Returns a copy of `spec` without the given paths. */
export function withoutPaths(
  spec: PostgrestOpenApiSpec,
  ...paths: string[]
): PostgrestOpenApiSpec {
  return {
    ...spec,
    paths: Object.fromEntries(
      Object.entries(spec.paths).filter(([path]) => !paths.includes(path)),
    ),
  }
}

/** The capture without the colliding function: the default for tests. */
export const probeSpec: PostgrestOpenApiSpec = withoutPaths(
  probeSpecWithCollision,
  '/rpc/list_tasks',
)
