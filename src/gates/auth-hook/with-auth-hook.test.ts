import { describe, expect, it, vi } from 'vitest'

import type { SendEmailHookPayload } from './types.js'
import { withAuthHook } from './with-auth-hook.js'

const encoder = new TextEncoder()

function base64ToBytes(base64: string): Uint8Array<ArrayBuffer> {
  const binary = atob(base64)
  const bytes = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i)
  return bytes
}

function bytesToBase64(buffer: ArrayBuffer): string {
  const view = new Uint8Array(buffer)
  let binary = ''
  for (let i = 0; i < view.length; i++) binary += String.fromCharCode(view[i]!)
  return btoa(binary)
}

async function sign(
  secretBase64: string,
  id: string,
  timestamp: string,
  body: string,
): Promise<string> {
  const key = await crypto.subtle.importKey(
    'raw',
    base64ToBytes(secretBase64),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  )
  const sig = await crypto.subtle.sign(
    'HMAC',
    key,
    encoder.encode(`${id}.${timestamp}.${body}`),
  )
  return bytesToBase64(sig)
}

const SECRET = btoa('super-secret-key-for-tests')

/** Builds a POST request signed with `SECRET` (valid by default). */
async function signedRequest(
  body: string,
  { sign: doSign = true }: { sign?: boolean } = {},
): Promise<Request> {
  const id = 'msg_1'
  const ts = Math.floor(Date.now() / 1000).toString()
  const signature = doSign
    ? `v1,${await sign(SECRET, id, ts, body)}`
    : 'v1,deadbeef'
  return new Request('http://localhost/', {
    method: 'POST',
    body,
    headers: {
      'webhook-id': id,
      'webhook-timestamp': ts,
      'webhook-signature': signature,
    },
  })
}

const sendEmailPayload: SendEmailHookPayload = {
  user: {
    id: 'uuid-1',
    aud: 'authenticated',
    role: 'authenticated',
    email: 'jane@example.com',
    app_metadata: { provider: 'email' },
    user_metadata: { sub: 'uuid-1' },
    created_at: '2026-01-01T00:00:00Z',
    updated_at: '2026-01-01T00:00:00Z',
  },
  email_data: {
    token: '123456',
    token_hash: 'hash',
    token_new: '',
    token_hash_new: '',
    redirect_to: 'http://localhost:3000',
    email_action_type: 'magiclink',
    site_url: 'http://localhost:3000',
  },
}

describe('withAuthHook', () => {
  it('admits a verified request and injects the parsed payload', async () => {
    const body = JSON.stringify(sendEmailPayload)
    const inner = vi.fn(async (_req: Request, ctx) => {
      expect(ctx.authHook.payload).toEqual(sendEmailPayload)
      expect(ctx.authHook.webhookId).toBe('msg_1')
      expect(typeof ctx.authHook.timestamp).toBe('number')
      return Response.json({ ok: true })
    })

    const handler = withAuthHook({ secret: SECRET }, inner)
    const res = await handler(await signedRequest(body))

    expect(res.status).toBe(200)
    expect(inner).toHaveBeenCalledOnce()
  })

  it('narrows the payload type via the generic argument', async () => {
    const body = JSON.stringify(sendEmailPayload)
    const handler = withAuthHook<SendEmailHookPayload>(
      { secret: SECRET },
      async (_req, ctx) =>
        // Compile-time check: these fields exist only on SendEmailHookPayload.
        Response.json({
          action: ctx.authHook.payload.email_data.email_action_type,
          email: ctx.authHook.payload.user.email,
        }),
    )

    const res = await handler(await signedRequest(body))
    expect(await res.json()).toEqual({
      action: 'magiclink',
      email: 'jane@example.com',
    })
  })

  it('accepts the dashboard secret form (v1,whsec_<base64>)', async () => {
    const body = JSON.stringify({ hello: 'world' })
    const handler = withAuthHook({ secret: `v1,whsec_${SECRET}` }, async () =>
      Response.json({ ok: true }),
    )

    const res = await handler(await signedRequest(body))
    expect(res.status).toBe(200)
  })

  it('rejects an invalid signature with 401 by default', async () => {
    const body = JSON.stringify({ hello: 'world' })
    const inner = vi.fn(async () => Response.json({ ok: true }))

    const handler = withAuthHook({ secret: SECRET }, inner)
    const res = await handler(await signedRequest(body, { sign: false }))

    expect(res.status).toBe(401)
    expect(await res.json()).toEqual({ error: 'invalid_signature' })
    expect(inner).not.toHaveBeenCalled()
  })

  it('honors a custom rejectStatus and rejectBody', async () => {
    const body = JSON.stringify({ hello: 'world' })
    const handler = withAuthHook(
      { secret: SECRET, rejectStatus: 403, rejectBody: { code: 'NOPE' } },
      async () => Response.json({ ok: true }),
    )

    const res = await handler(await signedRequest(body, { sign: false }))
    expect(res.status).toBe(403)
    expect(await res.json()).toEqual({ code: 'NOPE' })
  })
})
