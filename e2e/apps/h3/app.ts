// Minimal H3 app exercising @supabase/server from dist/ (not src/) through the
// H3 bridge in examples/frameworks/ — the same file consumers copy into their
// own projects. Config is read from process.env; no mocked env anywhere.
import { H3 } from 'h3'
import type { Contributions } from '@supabase/middleware'

import { toH3 } from '../../../examples/frameworks/h3/supabase-middleware.ts'
import { withSupabaseAdminClient } from '../../../dist/middleware/admin-client/index.mjs'
import { withClaims } from '../../../dist/middleware/claims/index.mjs'
import { withSupabaseClient } from '../../../dist/middleware/client/index.mjs'
import { withRequiredClaims } from '../../../dist/middleware/required-claims/index.mjs'
import { toUserClaims } from '../claims.ts'
import { insertNote, listAllNotes, listNotes, listOwnNotes } from '../notes.ts'
import { startFetchServer } from '../../setup/serve.ts'

// `withRequiredClaims` rejects a missing or invalid JWT before the route runs
// — the gate `auth: 'user'` applied. `withClaims` lets an anonymous request
// through with `jwtClaims: null`, which is what `auth: ['user', 'none']` did.
// Both contribute `jwtClaims`, so they cannot share an array.
const gatedEntries = [
  withRequiredClaims(),
  withSupabaseClient(),
  withSupabaseAdminClient(),
] as const
const optionalEntries = [withClaims()] as const

// `event.context` is not generic, so contributions are read through
// `Contributions<typeof entries>` at each call site.
type Gated = Contributions<typeof gatedEntries>
type Optional = Contributions<typeof optionalEntries>

const app = new H3()

// Each bridge call folds its pipeline once. H3 scopes an array to a path with
// `app.use(path, ...)`, registered ahead of the routes under that path.
const gate = toH3(gatedEntries)
app.use('/me', gate)
app.use('/notes', gate)
app.use('/my-notes', gate)
app.use('/all-notes', gate)
app.use('/me-optional', toH3(optionalEntries))

app.get('/health', () => ({ status: 'ok' }))

app.get('/me', (event) => ({
  userClaims: toUserClaims((event.context as Gated).jwtClaims),
}))

app.get('/me-optional', (event) => ({
  userClaims: toUserClaims((event.context as Optional).jwtClaims),
}))

app.get('/notes', (event) => {
  const { supabaseAdmin, jwtClaims } = event.context as Gated
  return listNotes(supabaseAdmin, jwtClaims.sub)
})

// User-scoped client: RLS does the scoping, no WHERE clause.
app.get('/my-notes', (event) => listOwnNotes((event.context as Gated).supabase))

// Admin client, no filter: sees every user's rows regardless of caller.
app.get('/all-notes', (event) =>
  listAllNotes((event.context as Gated).supabaseAdmin),
)

app.post('/notes', async (event) => {
  const { supabaseAdmin, jwtClaims } = event.context as Gated
  const { body } = (await event.req.json()) as { body?: string }
  if (!body) return Response.json({ error: 'body required' }, { status: 400 })
  const note = await insertNote(supabaseAdmin, jwtClaims.sub, body)
  return Response.json(note, { status: 201 })
})

export function start(port: number) {
  return startFetchServer(app.fetch, port)
}
