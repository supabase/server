/**
 * Cloudflare Zero Trust Access gate.
 *
 * Validates the `Cf-Access-Jwt-Assertion` header against the team's JWKS,
 * checks the audience tag binding, and contributes the identity claims to
 * `ctx.access`.
 *
 * Use this for backend services that sit behind a Cloudflare tunnel + Access
 * policy — every request is signed by Cloudflare on the way in.
 *
 * @see https://developers.cloudflare.com/cloudflare-one/identity/authorization-cookie/validating-json/
 */

import { createRemoteJWKSet, jwtVerify, type JWTPayload } from 'jose'

import { defineGate } from '../../core/gates/index.js'

const HEADER_NAME = 'cf-access-jwt-assertion'

export interface WithAccessConfig {
  /**
   * Your Cloudflare team domain — `<team>.cloudflareaccess.com` (no protocol,
   * no path). Used to derive the JWKS URL and the expected `iss` claim.
   *
   * Find it at https://one.dash.cloudflare.com/ → Settings → Custom Pages.
   */
  teamDomain: string

  /**
   * The Application Audience (AUD) tag from your Access policy. The gate
   * rejects tokens whose `aud` claim doesn't include this value.
   *
   * Find it at Zero Trust → Access → Applications → <your app> → Overview.
   */
  audience: string

  /**
   * Override the JWKS URL. By default derived from `teamDomain`. Useful for
   * tests; otherwise leave unset.
   */
  jwksUrl?: string
}

/** Shape contributed at `ctx.access` after a successful verification. */
export interface AccessState {
  /** The user's email address from the verified token. */
  email: string | null
  /** The `sub` claim — Cloudflare's stable identity id for this user. */
  sub: string
  /** Cloudflare's identity nonce, useful for cache-busting per session. */
  identityNonce: string | null
  /** The `aud` claim that was validated. */
  audience: string
  /** The full verified JWT payload, for accessing custom claims. */
  claims: JWTPayload
}

/**
 * Cloudflare Zero Trust Access gate.
 *
 * @example
 * ```ts
 * import { chain } from '@supabase/server/core/gates'
 * import { withAccess } from '@supabase/server/gates/cloudflare'
 *
 * export default {
 *   fetch: chain(
 *     withAccess({
 *       teamDomain: 'acme.cloudflareaccess.com',
 *       audience: process.env.CF_ACCESS_AUD!,
 *     }),
 *   )(async (req, ctx) => {
 *     return Response.json({ user: ctx.access.email })
 *   }),
 * }
 * ```
 */
export const withAccess = defineGate<
  'access',
  WithAccessConfig,
  Record<never, never>,
  AccessState
>({
  key: 'access',
  run: (config) => {
    const issuer = `https://${config.teamDomain}`
    const jwksUrl = config.jwksUrl ?? `${issuer}/cdn-cgi/access/certs`
    const jwks = createRemoteJWKSet(new URL(jwksUrl))

    return async (req) => {
      const token = req.headers.get(HEADER_NAME)
      if (!token) {
        return {
          kind: 'reject',
          response: Response.json(
            { error: 'access_token_missing' },
            { status: 401 },
          ),
        }
      }

      try {
        const { payload } = await jwtVerify(token, jwks, {
          issuer,
          audience: config.audience,
        })

        const email = typeof payload.email === 'string' ? payload.email : null
        const identityNonce =
          typeof payload.identity_nonce === 'string'
            ? payload.identity_nonce
            : null

        return {
          kind: 'pass',
          contribution: {
            email,
            sub: payload.sub ?? '',
            identityNonce,
            audience: config.audience,
            claims: payload,
          },
        }
      } catch (err) {
        return {
          kind: 'reject',
          response: Response.json(
            {
              error: 'access_token_invalid',
              detail: err instanceof Error ? err.message : 'unknown',
            },
            { status: 401 },
          ),
        }
      }
    }
  },
})
