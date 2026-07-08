// Minimal Hono app exercising @supabase/server from dist/ (not src/), with
// config read from process.env via resolveEnv() — no mocked env anywhere.
import { Hono } from 'hono'

import { withSupabase } from '../../../dist/adapters/hono/index.mjs'
import type { SupabaseContext } from '../../../dist/index.mjs'
import { insertNote, listNotes, listOwnNotes } from '../notes.ts'
import { startFetchServer } from '../../setup/serve.ts'

type Env = { Variables: { supabaseContext: SupabaseContext } }

const app = new Hono<Env>()

app.get('/health', (c) => c.json({ status: 'ok' }))

app.use('/me', withSupabase({ auth: 'user' }))
app.use('/me-optional', withSupabase({ auth: ['user', 'none'] }))
app.use('/notes', withSupabase({ auth: 'user' }))
app.use('/my-notes', withSupabase({ auth: 'user' }))

app.get('/me', (c) => c.json({ userClaims: c.var.supabaseContext.userClaims }))

app.get('/me-optional', (c) =>
  c.json({ userClaims: c.var.supabaseContext.userClaims }),
)

app.get('/notes', async (c) => {
  const { supabaseAdmin, userClaims } = c.var.supabaseContext
  return c.json(await listNotes(supabaseAdmin, userClaims!.id))
})

// User-scoped client: RLS does the scoping, no WHERE clause.
app.get('/my-notes', async (c) =>
  c.json(await listOwnNotes(c.var.supabaseContext.supabase)),
)

app.post('/notes', async (c) => {
  const { supabaseAdmin, userClaims } = c.var.supabaseContext
  const { body } = await c.req.json<{ body?: string }>()
  if (!body) return c.json({ error: 'body required' }, 400)
  return c.json(await insertNote(supabaseAdmin, userClaims!.id, body), 201)
})

export function start(port: number) {
  return startFetchServer(app.fetch, port)
}
