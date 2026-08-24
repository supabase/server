// Minimal app on the CORE withSupabase(config, handler) fetch wrapper — no
// framework adapter. This is the exact programming model Supabase Edge
// Functions use (`Deno.serve(withSupabase(...))`); here the same handler runs
// behind node:http. The same surface runs on the real Deno edge runtime in
// e2e/supabase/functions/server-e2e/ — keep the two in sync.
//
// The core wrapper has no router, so routes are dispatched on pathname and
// each auth mode gets its own wrapped handler.
import { withSupabase } from '../../../dist/index.mjs'
import { withPostgresClient } from '../../../dist/middleware/postgres/index.mjs'
import { withPostgresAdminClient } from '../../../dist/middleware/postgres-admin/index.mjs'
import type { NoteRow } from '../notes.ts'
import { insertNote, listAllNotes, listNotes, listOwnNotes } from '../notes.ts'
import { startFetchServer } from '../../setup/serve.ts'

const userHandler = withSupabase({ auth: 'user' }, async (req, ctx) => {
  const { pathname } = new URL(req.url)
  const { supabase, supabaseAdmin, userClaims } = ctx

  if (pathname === '/me') return Response.json({ userClaims })
  if (pathname === '/my-notes') {
    return Response.json(await listOwnNotes(supabase))
  }
  if (pathname === '/all-notes') {
    return Response.json(await listAllNotes(supabaseAdmin))
  }
  if (pathname === '/notes' && req.method === 'GET') {
    return Response.json(await listNotes(supabaseAdmin, userClaims!.id))
  }
  if (pathname === '/notes' && req.method === 'POST') {
    const { body } = (await req.json()) as { body?: string }
    if (!body) {
      return Response.json({ error: 'body required' }, { status: 400 })
    }
    const note = await insertNote(supabaseAdmin, userClaims!.id, body)
    return Response.json(note, { status: 201 })
  }
  return Response.json({ error: 'not found' }, { status: 404 })
})

// ctx.postgres — a direct pg connection scoped to the caller by RLS. The query
// has no WHERE clause: the rows come back scoped because withPostgresClient injects
// the caller's claims and drops to their role inside the transaction, so
// auth.uid() resolves and the notes policy applies. Reads SUPABASE_DB_URL,
// which the Supabase CLI injects into the edge runtime and pnpm gen:env
// writes into e2e/.env for this Node app.
// Both halves composed together — one pool, two clients. /my-notes-pg reads
// through the RLS-scoped one and /all-notes-pg through the admin one, running
// the *identical* SQL. That the same query returns different rows is the whole
// security boundary under test.
// Shared between both routes, so it is a constant rather than a literal at
// each call site — `queryRaw` is the path for SQL text held in a variable.
// It carries no interpolation, so there is nothing to parameterize.
const PG_QUERY = 'select id, user_id, body from notes order by created_at'

const postgresHandler = withSupabase(
  {
    auth: 'user',
    middleware: [withPostgresClient(), withPostgresAdminClient()],
  },
  async (req, ctx) => {
    const { pathname } = new URL(req.url)
    if (pathname === '/all-notes-pg') {
      return Response.json(await ctx.postgresAdmin.queryRaw<NoteRow>(PG_QUERY))
    }
    return Response.json(await ctx.postgres.queryRaw<NoteRow>(PG_QUERY))
  },
)

const optionalHandler = withSupabase(
  { auth: ['user', 'none'] },
  async (_req, ctx) => Response.json({ userClaims: ctx.userClaims }),
)

function fetchHandler(req: Request): Response | Promise<Response> {
  const { pathname } = new URL(req.url)
  if (pathname === '/health') return Response.json({ status: 'ok' })
  if (pathname === '/me-optional') return optionalHandler(req)
  if (pathname === '/my-notes-pg' || pathname === '/all-notes-pg')
    return postgresHandler(req)
  return userHandler(req)
}

export function start(port: number) {
  return startFetchServer(fetchHandler, port)
}
