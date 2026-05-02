/**
 * Webhook signature verification gate.
 *
 * Verifies the HMAC signature on an inbound webhook against a shared secret,
 * checks the replay window, and contributes the parsed event + raw body to
 * `ctx.state.webhook`. Stripe is the canonical provider; supply a custom
 * `verify` function to plug in others (Svix/Resend, GitHub, Slack, Shopify).
 */

import { defineGate } from '../../core/gates/index.js'

const FIVE_MIN_MS = 5 * 60 * 1000

export type WebhookProvider =
  | { kind: 'stripe'; secret: string | string[]; toleranceMs?: number }
  | {
      kind: 'custom'
      /**
       * Verify the inbound request and return a `WebhookSuccess` to admit it
       * or a `WebhookFailure` to reject. The gate calls this with the raw
       * body string already consumed; emit your own response shape if needed.
       */
      verify: (
        req: Request,
        rawBody: string,
      ) => Promise<WebhookVerifyResult> | WebhookVerifyResult
    }

export type WebhookVerifyResult =
  | { ok: true; event: unknown; deliveryId: string; timestamp: number }
  | { ok: false; status?: number; error?: string }

export interface WithWebhookConfig {
  provider: WebhookProvider
}

/** Shape contributed at `ctx.state.webhook` after a successful verification. */
export interface WebhookState {
  /** The parsed JSON event body. */
  event: unknown
  /** The raw body bytes (as string) the signature was computed over. */
  rawBody: string
  /** Provider-specific delivery id (for idempotency / dedupe). */
  deliveryId: string
  /** Provider-supplied event timestamp (ms epoch). */
  timestamp: number
}

/**
 * Webhook signature verification gate.
 *
 * @example
 * ```ts
 * import { chain } from '@supabase/server/core/gates'
 * import { withWebhook } from '@supabase/server/gates/webhook'
 *
 * export default {
 *   fetch: chain(
 *     withWebhook({
 *       provider: {
 *         kind: 'stripe',
 *         secret: process.env.STRIPE_WEBHOOK_SECRET!,
 *       },
 *     }),
 *   )(async (req, ctx) => {
 *     // ctx.state.webhook.event is the parsed Stripe event
 *     // ctx.state.webhook.rawBody is the raw bytes (preserved here)
 *     return new Response(null, { status: 204 })
 *   }),
 * }
 * ```
 */
export const withWebhook = defineGate<
  'webhook',
  WithWebhookConfig,
  Record<never, never>,
  WebhookState
>({
  namespace: 'webhook',
  run: (config) => async (req) => {
    const rawBody = await req.text()
    const result =
      config.provider.kind === 'custom'
        ? await config.provider.verify(req, rawBody)
        : await verifyStripe(req, rawBody, config.provider)

    if (!result.ok) {
      return {
        kind: 'reject',
        response: Response.json(
          { error: result.error ?? 'invalid_signature' },
          { status: result.status ?? 401 },
        ),
      }
    }

    return {
      kind: 'pass',
      contribution: {
        event: result.event,
        rawBody,
        deliveryId: result.deliveryId,
        timestamp: result.timestamp,
      },
    }
  },
})

async function verifyStripe(
  req: Request,
  rawBody: string,
  provider: { kind: 'stripe'; secret: string | string[]; toleranceMs?: number },
): Promise<WebhookVerifyResult> {
  const header = req.headers.get('stripe-signature')
  if (!header) return { ok: false, error: 'signature_missing' }

  const parsed = parseStripeHeader(header)
  if (!parsed) return { ok: false, error: 'signature_malformed' }

  const tolerance = provider.toleranceMs ?? FIVE_MIN_MS
  const ageMs = Math.abs(Date.now() - parsed.t * 1000)
  if (ageMs > tolerance) {
    return { ok: false, error: 'signature_expired' }
  }

  const signedPayload = `${parsed.t}.${rawBody}`
  const secrets = Array.isArray(provider.secret)
    ? provider.secret
    : [provider.secret]

  let matched = false
  for (const secret of secrets) {
    const expected = await hmacSha256Hex(secret, signedPayload)
    for (const v1 of parsed.v1) {
      if (timingSafeEqualHex(expected, v1)) {
        matched = true
        break
      }
    }
    if (matched) break
  }
  if (!matched) return { ok: false, error: 'signature_invalid' }

  let event: { id?: string; created?: number } & Record<string, unknown>
  try {
    event = JSON.parse(rawBody) as typeof event
  } catch {
    return { ok: false, error: 'body_not_json' }
  }

  return {
    ok: true,
    event,
    deliveryId: typeof event.id === 'string' ? event.id : '',
    timestamp:
      typeof event.created === 'number'
        ? event.created * 1000
        : parsed.t * 1000,
  }
}

function parseStripeHeader(header: string): { t: number; v1: string[] } | null {
  const parts = header.split(',')
  let t: number | null = null
  const v1: string[] = []
  for (const part of parts) {
    const eq = part.indexOf('=')
    if (eq < 0) continue
    const k = part.slice(0, eq).trim()
    const v = part.slice(eq + 1).trim()
    if (k === 't') t = Number(v)
    else if (k === 'v1') v1.push(v)
  }
  if (t === null || Number.isNaN(t) || v1.length === 0) return null
  return { t, v1 }
}

async function hmacSha256Hex(secret: string, payload: string): Promise<string> {
  const enc = new TextEncoder()
  const key = await crypto.subtle.importKey(
    'raw',
    enc.encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  )
  const sig = await crypto.subtle.sign('HMAC', key, enc.encode(payload))
  const bytes = new Uint8Array(sig)
  let hex = ''
  for (let i = 0; i < bytes.length; i++) {
    hex += bytes[i]!.toString(16).padStart(2, '0')
  }
  return hex
}

function timingSafeEqualHex(a: string, b: string): boolean {
  if (a.length !== b.length) return false
  let mismatch = 0
  for (let i = 0; i < a.length; i++) {
    mismatch |= a.charCodeAt(i) ^ b.charCodeAt(i)
  }
  return mismatch === 0
}
