/**
 * Auth-hook gate — verifies a Supabase Auth Hook's Standard Webhooks signature
 * and injects the decoded payload at `ctx.authHook`.
 *
 * Write a hook endpoint (Send Email, Send SMS, Custom Access Token, …) without
 * the security boilerplate: the gate strips the `v1,whsec_` secret, checks the
 * `webhook-id` / `webhook-timestamp` / `webhook-signature` headers, enforces a
 * replay window, and only then hands your handler the parsed body. An invalid
 * or missing signature short-circuits with `401`.
 *
 * @packageDocumentation
 */

import { defineGate, type Conflict } from '../../core/gates/index.js'

import type { AuthHookPayload } from './types.js'
import { verifyStandardWebhook } from './verify.js'

/**
 * Per-instance configuration passed to `withAuthHook(config, handler)`.
 */
export interface WithAuthHookConfig {
  /**
   * The hook secret from the Supabase dashboard. Accepts the stored form
   * `v1,whsec_<base64>`, the bare Standard Webhooks form `whsec_<base64>`, or
   * just the `<base64>` key — the prefixes are stripped before use.
   */
  secret: string

  /**
   * Replay-protection window in seconds. A request whose `webhook-timestamp` is
   * further than this from now is rejected.
   *
   * @defaultValue `300`
   */
  toleranceInSeconds?: number

  /**
   * HTTP status when verification fails.
   *
   * @defaultValue `401`
   */
  rejectStatus?: number

  /**
   * Body when verification fails.
   *
   * @defaultValue `{ error: 'invalid_signature' }`
   */
  rejectBody?: unknown
}

/**
 * Shape contributed at `ctx.authHook` after a verified request. `payload` is
 * the parsed hook body; `webhookId` and `timestamp` come from the verified
 * headers.
 */
export interface AuthHookContribution<Payload = AuthHookPayload> {
  payload: Payload
  webhookId: string
  timestamp: number
}

const DEFAULT_TOLERANCE_SECONDS = 300

/**
 * Runtime gate. Contribution is fixed to {@link AuthHookContribution} here; the
 * payload-generic surface is layered on by {@link WithAuthHook} below.
 */
const authHookGate = defineGate<
  'authHook',
  WithAuthHookConfig,
  Record<never, never>,
  AuthHookContribution
>({
  key: 'authHook',
  run: (config) => async (req) => {
    // Standard Webhooks signs the raw body, so read text (not json) and verify
    // before parsing.
    const body = await req.text()
    const result = await verifyStandardWebhook(
      config.secret,
      body,
      req.headers,
      config.toleranceInSeconds ?? DEFAULT_TOLERANCE_SECONDS,
    )

    if (!result.ok) {
      return Response.json(
        config.rejectBody ?? { error: 'invalid_signature' },
        {
          status: config.rejectStatus ?? 401,
        },
      )
    }

    // Headers are guaranteed present once verification succeeds.
    return {
      authHook: {
        payload: JSON.parse(body) as AuthHookPayload,
        webhookId: req.headers.get('webhook-id')!,
        timestamp: Number(req.headers.get('webhook-timestamp')),
      },
    }
  },
})

/** `true` only when `T` is exactly `any` — mirrors the carve-out in `defineGate`. */
type IsAny<T> = boolean extends (T extends never ? true : false) ? true : false

/**
 * Resolves to a {@link Conflict} sentinel when `Base` already carries an
 * `authHook` key, surfacing the collision at the gate's call site.
 */
type NoAuthHookConflict<Base> =
  IsAny<Base> extends true
    ? object
    : 'authHook' extends keyof Base
      ? Conflict<'authHook'>
      : object

/**
 * Public, payload-generic surface for {@link withAuthHook}.
 *
 * `defineGate` fixes the contribution type, so the gate is re-typed here to add
 * a leading `Payload` type parameter (default {@link AuthHookPayload}). The
 * `Base` parameter and `NoAuthHookConflict` constraint reproduce the gate
 * machinery: `Base` is inferred from an outer wrapper so the gate can compose
 * inside `withSupabase`, and a duplicate `authHook` key is a type error.
 */
export interface WithAuthHook {
  <
    Payload = AuthHookPayload,
    Base extends NoAuthHookConflict<Base> = Record<never, never>,
  >(
    config: WithAuthHookConfig,
    handler: (
      req: Request,
      ctx: Base & { authHook: AuthHookContribution<Payload> },
    ) => Promise<Response>,
  ): ((req: Request, baseCtx: Base) => Promise<Response>) &
    ((req: Request) => Promise<Response>)
}

/**
 * Auth-hook gate.
 *
 * @example Send Email Hook
 * ```ts
 * import { withAuthHook, type SendEmailHookPayload } from '@supabase/server/gates/auth-hook'
 *
 * export default {
 *   fetch: withAuthHook<SendEmailHookPayload>(
 *     { secret: process.env.SEND_EMAIL_HOOK_SECRET! },
 *     async (_req, ctx) => {
 *       const { user, email_data } = ctx.authHook.payload
 *       // ...send the email with your provider...
 *       return new Response(null, { status: 200 })
 *     },
 *   ),
 * }
 * ```
 */
export const withAuthHook = authHookGate as unknown as WithAuthHook
