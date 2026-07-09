// The one scenario set that runs against all four adapters. Every request
// here travels over real HTTP to a live server; every JWT is a real
// GoTrue-issued token verified against the local stack's live JWKS endpoint.
import { describe, expect, inject, it } from 'vitest'

import type { NoteRow } from './apps/notes.ts'
import type { TestUser } from './setup/token.ts'

interface ClaimsResponse {
  userClaims: { id: string; email?: string; role?: string } | null
}

function bearer(user: TestUser): Record<string, string> {
  return { Authorization: `Bearer ${user.token}` }
}

export function runAdapterScenarios(adapter: string, baseUrl: string): void {
  const { user1, user2 } = inject('e2eUsers')
  const forgedToken = inject('forgedToken')

  describe(`${adapter}: auth`, () => {
    it('GET /health is public', async () => {
      const res = await fetch(`${baseUrl}/health`)
      expect(res.status).toBe(200)
      expect(await res.json()).toEqual({ status: 'ok' })
    })

    it('GET /me without a token → 401', async () => {
      const res = await fetch(`${baseUrl}/me`)
      expect(res.status).toBe(401)
    })

    it('GET /me with a garbage token → 401', async () => {
      const res = await fetch(`${baseUrl}/me`, {
        headers: { Authorization: 'Bearer not-a-real-jwt' },
      })
      expect(res.status).toBe(401)
    })

    it('GET /me with a well-formed JWT signed by the wrong key → 401', async () => {
      // Same alg and kid as the live JWKS, wrong signing key — this must
      // fail at signature verification, not at structure checks.
      const res = await fetch(`${baseUrl}/me`, {
        headers: { Authorization: `Bearer ${forgedToken}` },
      })
      expect(res.status).toBe(401)
    })

    it('GET /me with a valid token → 200 with the caller identity', async () => {
      const res = await fetch(`${baseUrl}/me`, { headers: bearer(user1) })
      expect(res.status).toBe(200)
      const { userClaims } = (await res.json()) as ClaimsResponse
      expect(userClaims?.id).toBe(user1.id)
      expect(userClaims?.email).toBe(user1.email)
      expect(userClaims?.role).toBe('authenticated')
    })

    it('GET /me-optional without a token → 200 with null claims', async () => {
      const res = await fetch(`${baseUrl}/me-optional`)
      expect(res.status).toBe(200)
      const { userClaims } = (await res.json()) as ClaimsResponse
      expect(userClaims).toBeNull()
    })

    it('GET /me-optional with an invalid token → 401, not anonymous', async () => {
      // A present-but-invalid token must be rejected, never silently
      // downgraded to the 'none' mode.
      const res = await fetch(`${baseUrl}/me-optional`, {
        headers: { Authorization: 'Bearer not-a-real-jwt' },
      })
      expect(res.status).toBe(401)
    })

    it('GET /me-optional with a valid token → 200 with claims', async () => {
      const res = await fetch(`${baseUrl}/me-optional`, {
        headers: bearer(user1),
      })
      expect(res.status).toBe(200)
      const { userClaims } = (await res.json()) as ClaimsResponse
      expect(userClaims?.id).toBe(user1.id)
    })
  })

  describe(`${adapter}: data access`, () => {
    // Unique per adapter and run — all adapters share one notes table.
    const noteBody = `e2e note from ${adapter} ${crypto.randomUUID()}`
    let created: NoteRow

    it('POST /notes inserts a row scoped to the caller', async () => {
      const res = await fetch(`${baseUrl}/notes`, {
        method: 'POST',
        headers: { ...bearer(user1), 'Content-Type': 'application/json' },
        body: JSON.stringify({ body: noteBody }),
      })
      expect(res.status).toBe(201)
      created = (await res.json()) as NoteRow
      expect(created.user_id).toBe(user1.id)
      expect(created.body).toBe(noteBody)
    })

    it('POST /notes without a body → 400', async () => {
      const res = await fetch(`${baseUrl}/notes`, {
        method: 'POST',
        headers: { ...bearer(user1), 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      })
      expect(res.status).toBe(400)
    })

    it('GET /notes returns the created row', async () => {
      const res = await fetch(`${baseUrl}/notes`, { headers: bearer(user1) })
      expect(res.status).toBe(200)
      const rows = (await res.json()) as NoteRow[]
      expect(rows.some((row) => row.id === created.id)).toBe(true)
      expect(rows.every((row) => row.user_id === user1.id)).toBe(true)
    })

    it('GET /notes as a different user cannot see them', async () => {
      const res = await fetch(`${baseUrl}/notes`, { headers: bearer(user2) })
      expect(res.status).toBe(200)
      expect(await res.json()).toEqual([])
    })

    it('GET /all-notes via the admin client sees other users rows', async () => {
      // user2's request reads through supabaseAdmin with no filter — user1's
      // row must be visible, proving the admin client is not scoped to the
      // caller's identity and bypasses RLS.
      const res = await fetch(`${baseUrl}/all-notes`, {
        headers: bearer(user2),
      })
      expect(res.status).toBe(200)
      const rows = (await res.json()) as NoteRow[]
      expect(rows.some((row) => row.id === created.id)).toBe(true)
    })

    it('GET /my-notes scopes rows via RLS through the user client', async () => {
      // The route has no WHERE clause — the caller's JWT reaches PostgREST
      // through ctx.supabase and the RLS policy alone scopes the rows.
      const res = await fetch(`${baseUrl}/my-notes`, { headers: bearer(user1) })
      expect(res.status).toBe(200)
      const rows = (await res.json()) as NoteRow[]
      expect(rows.some((row) => row.id === created.id)).toBe(true)
      expect(rows.every((row) => row.user_id === user1.id)).toBe(true)
    })

    it('GET /my-notes as a different user is empty via RLS', async () => {
      const res = await fetch(`${baseUrl}/my-notes`, { headers: bearer(user2) })
      expect(res.status).toBe(200)
      expect(await res.json()).toEqual([])
    })
  })
}
