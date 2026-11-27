// Minimal Hono app exercising @supabase/server from dist/ (not src/) through
// the Hono bridge in examples/frameworks/ — the same file consumers copy into
// their own projects. Config is read from process.env; no mocked env anywhere.
import { Hono } from 'hono'

import { toHono } from '../../../examples/frameworks/hono/supabase-middleware.ts'
import { withSupabaseAdminClient } from '../../../dist/middleware/admin-client/index.mjs'
import { withClaims } from '../../../dist/middleware/claims/index.mjs'
import { withSupabaseClient } from '../../../dist/middleware/client/index.mjs'
import { withRequiredClaims } from '../../../dist/middleware/required-claims/index.mjs'
import { toUserClaims } from '../claims.ts'
import { insertNote, listAllNotes, listNotes, listOwnNotes } from '../notes.ts'
import { startFetchServer } from '../../setup/serve.ts'

// `withRequiredClaims` rejects a request with a missing or invalid JWT before
// any route runs — the gate `auth: 'user'` applied.
// `withClaims` does not reject a missing one: it contributes `jwtClaims: null`
// and falls through, which is what `auth: ['user', 'none']` did. The two
// cannot share an array, because both contribute `jwtClaims`.
const gate = toHono([
  withRequiredClaims(),
  withSupabaseClient(),
  withSupabaseAdminClient(),
])
// `withSupabaseClient()` rides along here so an anonymous request still
// builds a client. The adapters did that under `auth: ['user', 'none']`, and
// without it no framework app covers client construction on the anonymous
// path.
const optionalGate = toHono([withClaims(), withSupabaseClient()])

// Each bridge call folds its pipeline once, so `gate` is built once here and
// reused across the sub-apps below rather than called per mount.
//
// One sub-app per mounted path. A sub-app's `use('*', ...)` becomes `/<prefix>/*`
// when mounted, so mounting two of them at '/' would run the first one's
// middleware on the second one's routes — `/me-optional` would answer 401.
const me = new Hono()
  .use('*', gate)
  .get('/', (c) => c.json({ userClaims: toUserClaims(c.var.jwtClaims) }))

const meOptional = new Hono()
  .use('*', optionalGate)
  .get('/', (c) => c.json({ userClaims: toUserClaims(c.var.jwtClaims) }))

const notes = new Hono()
  .use('*', gate)
  .get('/', async (c) =>
    c.json(await listNotes(c.var.supabaseAdmin, c.var.jwtClaims.sub)),
  )
  .post('/', async (c) => {
    const { body } = await c.req.json<{ body?: string }>()
    if (!body) return c.json({ error: 'body required' }, 400)
    return c.json(
      await insertNote(c.var.supabaseAdmin, c.var.jwtClaims.sub, body),
      201,
    )
  })

// User-scoped client: RLS does the scoping, no WHERE clause.
const myNotes = new Hono()
  .use('*', gate)
  .get('/', async (c) => c.json(await listOwnNotes(c.var.supabase)))

// Admin client, no filter: sees every user's rows regardless of caller.
const allNotes = new Hono()
  .use('*', gate)
  .get('/', async (c) => c.json(await listAllNotes(c.var.supabaseAdmin)))

const app = new Hono()
  .get('/health', (c) => c.json({ status: 'ok' }))
  .route('/me', me)
  .route('/me-optional', meOptional)
  .route('/notes', notes)
  .route('/my-notes', myNotes)
  .route('/all-notes', allNotes)

export function start(port: number) {
  return startFetchServer(app.fetch, port)
}
