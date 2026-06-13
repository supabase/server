/**
 * Payload shapes Supabase sends to the various Auth Hooks.
 *
 * These mirror the bodies documented at
 * https://supabase.com/docs/guides/auth/auth-hooks. Fields Supabase may omit
 * for a given event are typed optional. {@link AuthHookPayload} is the default
 * the gate contributes; pass a specific member as the `withAuthHook<Payload>`
 * type argument to narrow `ctx.authHook.payload`.
 *
 * @packageDocumentation
 */

/**
 * The user record embedded in most auth-hook payloads. Matches the shape of a
 * row in `auth.users` as serialized for hooks.
 */
export interface AuthHookUser {
  id: string
  aud: string
  role: string
  email?: string
  phone?: string
  app_metadata: Record<string, unknown>
  user_metadata: Record<string, unknown>
  identities?: Array<Record<string, unknown>>
  created_at: string
  updated_at: string
  is_anonymous?: boolean
}

/** The kind of email Supabase is about to send, echoed in `email_data`. */
export type EmailActionType =
  | 'signup'
  | 'invite'
  | 'magiclink'
  | 'recovery'
  | 'email_change'
  | 'email_change_new'
  | 'reauthentication'

/** The `email_data` block of a {@link SendEmailHookPayload}. */
export interface EmailData {
  token: string
  token_hash: string
  token_new: string
  token_hash_new: string
  redirect_to: string
  email_action_type: EmailActionType
  site_url: string
  old_email?: string
  old_phone?: string
}

/** Payload for the Send Email Hook. */
export interface SendEmailHookPayload {
  user: AuthHookUser
  email_data: EmailData
}

/** Payload for the Send SMS Hook. */
export interface SendSMSHookPayload {
  user: AuthHookUser
  sms: {
    otp: string
  }
}

/** Payload for the Custom Access Token Hook. */
export interface CustomAccessTokenHookPayload {
  user_id: string
  claims: Record<string, unknown>
  authentication_method: string
}

/** Payload for the MFA Verification Attempt Hook. */
export interface MFAVerificationHookPayload {
  factor_id: string
  factor_type: string
  user_id: string
  valid: boolean
}

/** Payload for the Password Verification Attempt Hook. */
export interface PasswordVerificationHookPayload {
  user_id: string
  valid: boolean
}

/**
 * Union of the auth-hook payloads this package ships types for. The default for
 * `withAuthHook` — narrow it by passing a specific member as the type argument.
 */
export type AuthHookPayload =
  | SendEmailHookPayload
  | SendSMSHookPayload
  | CustomAccessTokenHookPayload
  | MFAVerificationHookPayload
  | PasswordVerificationHookPayload
