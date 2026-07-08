// Minimal H3 app exercising @supabase/server from dist/ (not src/), with
// config read from process.env via resolveEnv() — no mocked env anywhere.
import { H3, defineHandler } from 'h3'

import { withSupabase } from '../../../dist/adapters/h3/index.mjs'
import type { SupabaseContext } from '../../../dist/index.mjs'
import { insertNote, listNotes } from '../notes.ts'
import { startFetchServer } from '../../setup/serve.ts'

declare module 'h3' {
  interface H3EventContext {
    supabaseContext: SupabaseContext
  }
}

const requireUser = withSupabase({ auth: 'user' })
const optionalUser = withSupabase({ auth: ['user', 'none'] })

const app = new H3()

app.get('/health', () => ({ status: 'ok' }))

app.get(
  '/me',
  defineHandler({
    middleware: [requireUser],
    handler: (event) => ({
      userClaims: event.context.supabaseContext.userClaims,
    }),
  }),
)

app.get(
  '/me-optional',
  defineHandler({
    middleware: [optionalUser],
    handler: (event) => ({
      userClaims: event.context.supabaseContext.userClaims,
    }),
  }),
)

app.get(
  '/notes',
  defineHandler({
    middleware: [requireUser],
    handler: async (event) => {
      const { supabaseAdmin, userClaims } = event.context.supabaseContext
      return listNotes(supabaseAdmin, userClaims!.id)
    },
  }),
)

app.post(
  '/notes',
  defineHandler({
    middleware: [requireUser],
    handler: async (event) => {
      const { supabaseAdmin, userClaims } = event.context.supabaseContext
      const { body } = (await event.req.json()) as { body?: string }
      if (!body) {
        return Response.json({ error: 'body required' }, { status: 400 })
      }
      const note = await insertNote(supabaseAdmin, userClaims!.id, body)
      return Response.json(note, { status: 201 })
    },
  }),
)

export function start(port: number) {
  return startFetchServer(app.fetch, port)
}
