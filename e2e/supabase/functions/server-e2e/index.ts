// The e2e edge function: the same route surface as e2e/apps/core/app.ts —
// the same core withSupabase(config, handler) wrapper — but on the real
// Deno edge runtime behind the local gateway. Kept self-contained: the
// runtime mounts only supabase/functions/, so the shared e2e helpers are
// out of reach and the small dispatch + queries are duplicated by design.
// Keep the two files in sync when the route surface changes.
import { withSupabase } from '@supabase/server'

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

Deno.serve((req) => {
  const pathname = route(req)
  if (pathname === '/health') return Response.json({ status: 'ok' })
  if (pathname === '/me-optional') return optionalHandler(req)
  return userHandler(req)
})
