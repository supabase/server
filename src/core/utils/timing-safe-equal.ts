const encoder = new TextEncoder()

/**
 * Compares two strings in constant time to prevent timing attacks.
 *
 * Uses the double-HMAC technique: both strings are HMAC-signed with a random
 * ephemeral key, then the resulting signatures are compared byte-by-byte.
 * This ensures the comparison time is independent of where the strings differ,
 * preventing attackers from inferring key contents through response-time analysis.
 *
 * **Why double HMAC?** Direct byte comparison leaks timing information
 * (it short-circuits on the first mismatch). HMAC produces fixed-length
 * outputs that are uniformly distributed, so the XOR loop always processes
 * the same number of bytes regardless of input.
 *
 * @param a - First string to compare.
 * @param b - Second string to compare.
 * @returns `true` if the strings are equal, `false` otherwise.
 *
 * @example
 * ```ts
 * // Used internally by verifyCredentials to compare API keys
 * const isValid = await timingSafeEqual(providedKey, storedKey)
 * ```
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
