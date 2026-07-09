import { generateKeyPair, SignJWT } from 'jose'

/**
 * Mints a structurally valid JWT that mimics the local stack's real tokens —
 * same `alg` and `kid` as the live JWKS — but signed with a freshly generated
 * key the stack has never seen. It must fail signature verification: this is
 * the forged-token case that proves JWKS validation checks the signature,
 * not just the token's structure.
 */
export async function mintForgedToken(sub: string): Promise<string> {
  const jwksUrl = process.env.SUPABASE_JWKS_URL
  if (!jwksUrl) {
    throw new Error('SUPABASE_JWKS_URL is not set — run `pnpm gen:env` first.')
  }

  const jwks = (await (await fetch(jwksUrl)).json()) as {
    keys: Array<{ alg?: string; kid?: string; kty?: string }>
  }
  const key = jwks.keys[0]
  if (!key?.kid) {
    throw new Error(`JWKS at ${jwksUrl} has no usable key with a kid.`)
  }
  if (key.kty === 'oct') {
    throw new Error(
      'Local stack uses a symmetric signing key — cannot mint a forged ' +
        'asymmetric token. Newer Supabase stacks default to ES256.',
    )
  }
  const alg = key.alg ?? 'ES256'

  const { privateKey } = await generateKeyPair(alg)
  return new SignJWT({ role: 'authenticated', email: 'forged@example.com' })
    .setProtectedHeader({ alg, kid: key.kid })
    .setSubject(sub)
    .setIssuedAt()
    .setExpirationTime('1h')
    .sign(privateKey)
}
