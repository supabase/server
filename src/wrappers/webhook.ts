const encoder = new TextEncoder()

/**
 * Verifies a webhook signature using HMAC-SHA256.
 *
 * Computes the expected signature from the payload and shared secret, then
 * compares it to the provided signature using a timing-safe double-HMAC technique
 * to prevent timing attacks.
 *
 * **How it works:**
 * 1. Computes `HMAC-SHA256(secret, payload)` → expected signature (hex).
 * 2. Signs both the expected and provided signatures with a random ephemeral key.
 * 3. Compares the two HMACs byte-by-byte in constant time.
 *
 * @param payload - The raw request body as a string.
 * @param signature - The hex-encoded signature from the webhook header
 *   (e.g., from `X-Webhook-Signature` or `X-Hub-Signature-256`).
 * @param secret - The shared secret used to sign webhooks.
 *
 * @returns `true` if the signature is valid, `false` otherwise.
 *
 * @example Verify a webhook from an external service
 * ```ts
 * import { withSupabase } from '@supabase/edge-functions'
 * import { verifyWebhookSignature } from '@supabase/edge-functions/wrappers'
 *
 * export default {
 *   fetch: withSupabase({ allow: 'always' }, async (req, ctx) => {
 *     const payload = await req.text()
 *     const signature = req.headers.get('x-webhook-signature') ?? ''
 *     const secret = process.env.WEBHOOK_SECRET!
 *
 *     const isValid = await verifyWebhookSignature(payload, signature, secret)
 *     if (!isValid) {
 *       return Response.json({ error: 'Invalid signature' }, { status: 401 })
 *     }
 *
 *     // Process the verified webhook payload
 *     const event = JSON.parse(payload)
 *     await ctx.supabaseAdmin.from('webhook_events').insert(event)
 *
 *     return Response.json({ received: true })
 *   }),
 * }
 * ```
 */
export async function verifyWebhookSignature(
  payload: string,
  signature: string,
  secret: string,
): Promise<boolean> {
  const key = await crypto.subtle.importKey(
    'raw',
    encoder.encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  )

  const expected = await crypto.subtle.sign(
    'HMAC',
    key,
    encoder.encode(payload),
  )

  const expectedHex = Array.from(new Uint8Array(expected))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('')

  // Timing-safe comparison via double HMAC
  const compareKey = await crypto.subtle.importKey(
    'raw',
    crypto.getRandomValues(new Uint8Array(32)),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  )

  const [sigA, sigB] = await Promise.all([
    crypto.subtle.sign('HMAC', compareKey, encoder.encode(expectedHex)),
    crypto.subtle.sign('HMAC', compareKey, encoder.encode(signature)),
  ])

  const viewA = new Uint8Array(sigA)
  const viewB = new Uint8Array(sigB)

  if (viewA.length !== viewB.length) return false

  let result = 0
  for (let i = 0; i < viewA.length; i++) {
    result |= viewA[i]! ^ viewB[i]!
  }
  return result === 0
}
