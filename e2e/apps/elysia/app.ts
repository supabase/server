// Minimal Elysia app exercising @supabase/server from dist/ (not src/), with
// config read from process.env via resolveEnv() — no mocked env anywhere.
//
// Elysia is Bun-first, but `app.handle` is a plain fetch handler, so the app
// runs behind a node:http server (see setup/serve.ts) and CI needs no Bun.
import { Elysia } from 'elysia'

import { withSupabase } from '../../../dist/adapters/elysia/index.mjs'
import { insertNote, listNotes } from '../notes.ts'
import { startFetchServer } from '../../setup/serve.ts'

const app = new Elysia()
  .get('/health', () => ({ status: 'ok' }))
  .use(
    new Elysia()
      .use(withSupabase({ auth: ['user', 'none'] }))
      .get('/me-optional', ({ supabaseContext }) => ({
        userClaims: supabaseContext.userClaims,
      })),
  )
  .use(
    new Elysia()
      .use(withSupabase({ auth: 'user' }))
      .get('/me', ({ supabaseContext }) => ({
        userClaims: supabaseContext.userClaims,
      }))
      .get('/notes', ({ supabaseContext }) => {
        const { supabaseAdmin, userClaims } = supabaseContext
        return listNotes(supabaseAdmin, userClaims!.id)
      })
      .post('/notes', async ({ supabaseContext, body, set }) => {
        const { supabaseAdmin, userClaims } = supabaseContext
        const payload = body as { body?: string } | null
        if (!payload?.body) {
          set.status = 400
          return { error: 'body required' }
        }
        const note = await insertNote(
          supabaseAdmin,
          userClaims!.id,
          payload.body,
        )
        set.status = 201
        return note
      }),
  )

export function start(port: number) {
  return startFetchServer((req) => app.handle(req), port)
}
