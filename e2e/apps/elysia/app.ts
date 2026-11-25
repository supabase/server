// Minimal Elysia app exercising @supabase/server from dist/ (not src/) through
// the Elysia bridge in examples/frameworks/ — the same file consumers copy
// into their own projects. Config is read from process.env; no mocked env.
//
// Elysia is Bun-first, but `app.handle` is a plain fetch handler, so the app
// runs behind a node:http server (see setup/serve.ts) and CI needs no Bun.
import { Elysia } from 'elysia'

import {
  supabaseCtx,
  wrapElysia,
} from '../../../examples/frameworks/elysia/supabase-middleware.ts'
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

// Elysia's lifecycle hooks are request-phase only, so the entries wrap the
// whole app rather than sitting in a hook. That makes them app-wide: a second
// array needs its own instance, wrapped separately, with a dispatcher in front.
const gatedApp = new Elysia()
  .use(supabaseCtx<typeof gatedEntries>())
  .get('/me', ({ jwtClaims }) => ({ userClaims: toUserClaims(jwtClaims) }))
  .get('/notes', ({ supabaseAdmin, jwtClaims }) =>
    listNotes(supabaseAdmin, jwtClaims.sub),
  )
  // User-scoped client: RLS does the scoping, no WHERE clause.
  .get('/my-notes', ({ supabase }) => listOwnNotes(supabase))
  // Admin client, no filter: sees every user's rows regardless of caller.
  .get('/all-notes', ({ supabaseAdmin }) => listAllNotes(supabaseAdmin))
  .post('/notes', async ({ supabaseAdmin, jwtClaims, body, set }) => {
    const payload = body as { body?: string } | null
    if (!payload?.body) {
      set.status = 400
      return { error: 'body required' }
    }
    set.status = 201
    return insertNote(supabaseAdmin, jwtClaims.sub, payload.body)
  })

const optionalApp = new Elysia()
  .use(supabaseCtx<typeof optionalEntries>())
  .get('/me-optional', ({ jwtClaims }) => ({
    userClaims: toUserClaims(jwtClaims),
  }))

// `/health` composes no entries at all, so it needs no wrapper.
const publicApp = new Elysia().get('/health', () => ({ status: 'ok' }))

const gatedFetch = wrapElysia(gatedEntries, (req) => gatedApp.handle(req))
const optionalFetch = wrapElysia(optionalEntries, (req) =>
  optionalApp.handle(req),
)

function dispatch(req: Request): Response | Promise<Response> {
  const { pathname } = new URL(req.url)
  if (pathname === '/health') return publicApp.handle(req)
  if (pathname === '/me-optional') return optionalFetch(req)
  return gatedFetch(req)
}

export function start(port: number) {
  return startFetchServer(dispatch, port)
}
