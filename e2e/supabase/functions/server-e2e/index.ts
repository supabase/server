// The e2e edge function: the same route surface as e2e/apps/core/app.ts —
// the same core withSupabase(config, handler) wrapper — but on the real
// Deno edge runtime behind the local gateway. Kept self-contained: the
// runtime mounts only supabase/functions/, so the shared e2e helpers are
// out of reach and the small dispatch + queries are duplicated by design.
// Keep the two files in sync when the route surface changes.
import { withSupabase } from '@supabase/server'
import { withPostgresClient } from '@supabase/server/middleware/postgres'
import { withPostgresAdminClient } from '@supabase/server/middleware/postgres-admin'

const COLUMNS = 'id, user_id, body'

// The gateway forwards /functions/v1/server-e2e/<path> with the function
// name still in the pathname; some CLI versions strip it. Handle both.
function route(req: Request): string {
  const { pathname } = new URL(req.url)
  return pathname.replace(/^\/server-e2e/, '') || '/'
}

const userHandler = withSupabase({ auth: 'user' }, async (req, ctx) => {
  const pathname = route(req)
  const { supabase, supabaseAdmin, userClaims } = ctx

  if (pathname === '/me') return Response.json({ userClaims })

  if (pathname === '/my-notes') {
    // No WHERE clause — the caller's JWT reaches PostgREST through
    // ctx.supabase and the RLS policy alone scopes the rows.
    const { data, error } = await supabase
      .from('notes')
      .select(COLUMNS)
      .order('created_at', { ascending: true })
    if (error) throw new Error(`list own notes failed: ${error.message}`)
    return Response.json(data)
  }

  if (pathname === '/all-notes') {
    // Admin client, no filter — proves it is not scoped to the caller.
    const { data, error } = await supabaseAdmin
      .from('notes')
      .select(COLUMNS)
      .order('created_at', { ascending: true })
    if (error) throw new Error(`list all notes failed: ${error.message}`)
    return Response.json(data)
  }

  if (pathname === '/notes' && req.method === 'GET') {
    const { data, error } = await supabaseAdmin
      .from('notes')
      .select(COLUMNS)
      .eq('user_id', userClaims!.id)
      .order('created_at', { ascending: true })
    if (error) throw new Error(`list notes failed: ${error.message}`)
    return Response.json(data)
  }

  if (pathname === '/notes' && req.method === 'POST') {
    const { body } = (await req.json()) as { body?: string }
    if (!body) {
      return Response.json({ error: 'body required' }, { status: 400 })
    }
    const { data, error } = await supabaseAdmin
      .from('notes')
      .insert({ user_id: userClaims!.id, body })
      .select(COLUMNS)
      .single()
    if (error) throw new Error(`insert note failed: ${error.message}`)
    return Response.json(data, { status: 201 })
  }

  return Response.json({ error: 'not found' }, { status: 404 })
})

const optionalHandler = withSupabase(
  { auth: ['user', 'none'] },
  async (_req, ctx) => Response.json({ userClaims: ctx.userClaims }),
)

// The runtime claim under test: `pg` needs raw TCP, and this is the real Deno
// edge runtime.
//
// withPostgresClient defaults to SUPABASE_DB_URL, which is what a deployed function
// would use. Locally the CLI injects that variable pointing at the database's
// container name (`supabase_db_<project_id>`), whose underscores Deno's DNS
// resolver rejects — so e2e/supabase/config.toml supplies the equivalent URL
// under the `db` network alias and it is passed explicitly here. The Node core
// app covers the SUPABASE_DB_URL default path.
const connectionString = Deno.env.get('E2E_DB_URL')
const pgConfig = connectionString ? { connectionString } : {}
const PG_QUERY = `select ${COLUMNS} from notes order by created_at`

// Both halves composed together, running the identical query: /my-notes-pg is
// RLS-scoped, /all-notes-pg bypasses RLS. Same security boundary as the core
// app, but on the real Deno runtime.
const postgresHandler = withSupabase(
  {
    auth: 'user',
    middleware: [
      withPostgresClient(pgConfig),
      withPostgresAdminClient(pgConfig),
    ],
  },
  async (req, ctx) => {
    if (route(req) === '/all-notes-pg') {
      return Response.json(await ctx.postgresAdmin.query(PG_QUERY))
    }
    return Response.json(await ctx.postgres.query(PG_QUERY))
  },
)

Deno.serve((req) => {
  const pathname = route(req)
  if (pathname === '/health') return Response.json({ status: 'ok' })
  if (pathname === '/me-optional') return optionalHandler(req)
  if (pathname === '/my-notes-pg' || pathname === '/all-notes-pg')
    return postgresHandler(req)
  return userHandler(req)
})
