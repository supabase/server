/**
 * Cloudflare Turnstile bot-check gate.
 *
 * Verifies the `cf-turnstile-response` token a client widget produced against
 * Cloudflare's siteverify endpoint, then either short-circuits with a 401 or
 * contributes the verified challenge metadata to `ctx.turnstile`.
 *
 * @see https://developers.cloudflare.com/turnstile/get-started/server-side-validation/
 */

import { defineGate } from '../../core/gates/index.js'

const SITEVERIFY_URL =
  'https://challenges.cloudflare.com/turnstile/v0/siteverify'

export interface WithTurnstileConfig {
  /**
   * Turnstile secret key for your widget. Get one at
   * https://dash.cloudflare.com/?to=/:account/turnstile.
   */
  secretKey: string

  /**
   * If set, the gate rejects when the verified `action` doesn't match. Bind
   * your widget's client-side `action` to this so a token issued for one form
   * can't be replayed against a different endpoint.
   */
  expectedAction?: string

  /**
   * Where to find the Turnstile token on the inbound request. Defaults to
   * the `cf-turnstile-response` header. For form-encoded or JSON bodies,
   * supply a custom extractor — but be aware that consuming the body here
   * makes it unavailable to downstream handlers unless you `req.clone()` first.
   *
   * @defaultValue `(req) => req.headers.get('cf-turnstile-response')`
   */
  getToken?: (req: Request) => Promise<string | null> | string | null

  /**
   * Override the Turnstile siteverify URL. Useful for tests; otherwise leave
   * unset to hit Cloudflare's production endpoint.
   *
   * @defaultValue `'https://challenges.cloudflare.com/turnstile/v0/siteverify'`
   */
  siteverifyUrl?: string
}

/**
 * Shape contributed at `ctx.turnstile` after a successful verification.
 */
export interface TurnstileState {
  /** ISO 8601 timestamp when the challenge was solved. */
  challengeTs: string
  /** Hostname of the page the widget was rendered on. */
  hostname: string
  /** The action the widget was bound to. */
  action: string
  /** Custom data the client attached to the widget. */
  cdata: string | null
}

interface SiteverifyResponse {
  success: boolean
  challenge_ts?: string
  hostname?: string
  action?: string
  cdata?: string
  'error-codes'?: string[]
}

/**
 * Cloudflare Turnstile bot-check gate.
 *
 * @example
 * ```ts
 * import { chain } from '@supabase/server/core/gates'
 * import { withTurnstile } from '@supabase/server/gates/cloudflare'
 *
 * export default {
 *   fetch: chain(
 *     withTurnstile({
 *       secretKey: process.env.TURNSTILE_SECRET_KEY!,
 *       expectedAction: 'login',
 *     }),
 *   )(async (req, ctx) => {
 *     return Response.json({ ok: true, action: ctx.turnstile.action })
 *   }),
 * }
 * ```
 */
export const withTurnstile = defineGate<
  'turnstile',
  WithTurnstileConfig,
  Record<never, never>,
  TurnstileState
>({
  key: 'turnstile',
  run: (config) => {
    const url = config.siteverifyUrl ?? SITEVERIFY_URL
    const getToken = config.getToken ?? defaultGetToken

    return async (req) => {
      const token = await getToken(req)
      if (!token) {
        return {
          kind: 'reject',
          response: Response.json(
            { error: 'turnstile_token_missing' },
            { status: 401 },
          ),
        }
      }

      const params = new URLSearchParams()
      params.set('secret', config.secretKey)
      params.set('response', token)
      const remoteip = req.headers.get('cf-connecting-ip')
      if (remoteip) params.set('remoteip', remoteip)

      const verifyResponse = await fetch(url, {
        method: 'POST',
        body: params,
      })

      if (!verifyResponse.ok) {
        return {
          kind: 'reject',
          response: Response.json(
            {
              error: 'turnstile_verification_unavailable',
              status: verifyResponse.status,
            },
            { status: 503 },
          ),
        }
      }

      const result = (await verifyResponse.json()) as SiteverifyResponse

      if (!result.success) {
        return {
          kind: 'reject',
          response: Response.json(
            {
              error: 'turnstile_verification_failed',
              codes: result['error-codes'] ?? [],
            },
            { status: 401 },
          ),
        }
      }

      if (
        config.expectedAction !== undefined &&
        result.action !== config.expectedAction
      ) {
        return {
          kind: 'reject',
          response: Response.json(
            {
              error: 'turnstile_action_mismatch',
              expected: config.expectedAction,
              actual: result.action ?? null,
            },
            { status: 401 },
          ),
        }
      }

      return {
        kind: 'pass',
        contribution: {
          challengeTs: result.challenge_ts ?? '',
          hostname: result.hostname ?? '',
          action: result.action ?? '',
          cdata: result.cdata ?? null,
        },
      }
    }
  },
})

function defaultGetToken(req: Request): string | null {
  return req.headers.get('cf-turnstile-response')
}
