const encoder = new TextEncoder()

/**
 * Compares two strings in constant time to prevent timing attacks.
 * Uses the double-HMAC technique with a random ephemeral key.
 *
 * @internal
 */
export async function timingSafeEqual(a: string, b: string): Promise<boolean> {
  const key = crypto.getRandomValues(new Uint8Array(32))
  const cryptoKey = await crypto.subtle.importKey(
    'raw',
    key,
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  )

  const [sigA, sigB] = await Promise.all([
    crypto.subtle.sign('HMAC', cryptoKey, encoder.encode(a)),
    crypto.subtle.sign('HMAC', cryptoKey, encoder.encode(b)),
  ])

  if (sigA.byteLength !== sigB.byteLength) return false

  const viewA = new Uint8Array(sigA)
  const viewB = new Uint8Array(sigB)

  let result = 0
  for (let i = 0; i < viewA.length; i++) {
    result |= viewA[i]! ^ viewB[i]!
  }
  return result === 0
}
