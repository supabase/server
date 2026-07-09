// Minimal app on the CORE withSupabase(config, handler) fetch wrapper — no
// framework adapter. This is the exact programming model Supabase Edge
// Functions use (`Deno.serve(withSupabase(...))`); here the same handler runs
// behind node:http. A real Deno `supabase functions serve` e2e is tracked
// separately.
//
// The core wrapper has no router, so routes are dispatched on pathname and
// each auth mode gets its own wrapped handler.
import { withSupabase } from '../../../dist/index.mjs'
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

const optionalHandler = withSupabase(
  { auth: ['user', 'none'] },
  async (_req, ctx) => Response.json({ userClaims: ctx.userClaims }),
)

function fetchHandler(req: Request): Response | Promise<Response> {
  const { pathname } = new URL(req.url)
  if (pathname === '/health') return Response.json({ status: 'ok' })
  if (pathname === '/me-optional') return optionalHandler(req)
  return userHandler(req)
}

export function start(port: number) {
  return startFetchServer(fetchHandler, port)
}
