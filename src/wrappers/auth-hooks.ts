import type { SupabaseContext } from '../types.js'
import { withSupabase } from './with-supabase.js'
import { verifyWebhookSignature } from './webhook.js'

export interface AuthHookPayload {
  user: {
    id: string
    email?: string
    phone?: string
    raw_user_meta_data?: Record<string, unknown>
    raw_app_meta_data?: Record<string, unknown>
    [key: string]: unknown
  }
  [key: string]: unknown
}

export interface AuthHookContext extends SupabaseContext {
  userData: AuthHookPayload
}

export interface AuthHookResponse {
  decision: 'continue' | 'reject'
  message?: string
}

interface AuthHookConfig {
  webhookSecret?: string
}

function createAuthHookWrapper(hookType: string) {
  return function (
    handler: (req: Request, ctx: AuthHookContext) => Promise<AuthHookResponse>,
    config?: AuthHookConfig,
  ): (req: Request) => Promise<Response> {
    return withSupabase({ allow: 'always', cors: false }, async (req, ctx) => {
      const secret = config?.webhookSecret ?? getWebhookSecret()

      if (secret) {
        const body = await req.clone().text()
        const signature = req.headers.get('x-supabase-signature') ?? ''

        const valid = await verifyWebhookSignature(body, signature, secret)
        if (!valid) {
          return Response.json(
            { error: `Invalid ${hookType} webhook signature` },
            { status: 401 },
          )
        }
      }

      const payload = (await req.json()) as AuthHookPayload
      const hookCtx: AuthHookContext = { ...ctx, userData: payload }

      const result = await handler(req, hookCtx)

      if (result.decision === 'reject') {
        return Response.json(
          {
            decision: 'reject',
            message: result.message ?? 'Request rejected',
          },
          { status: 403 },
        )
      }

      return Response.json({ decision: 'continue' })
    })
  }
}

function getWebhookSecret(): string | undefined {
  if (typeof Deno !== 'undefined' && Deno.env?.get) {
    return Deno.env.get('SUPABASE_WEBHOOK_SECRET')
  }
  if (typeof process !== 'undefined' && process.env) {
    return process.env['SUPABASE_WEBHOOK_SECRET']
  }
  return undefined
}

export const beforeUserCreated = createAuthHookWrapper('beforeUserCreated')
export const afterUserCreated = createAuthHookWrapper('afterUserCreated')
