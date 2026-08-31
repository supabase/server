import type { ApiKeyFormat } from '../../errors.js'

/**
 * Classifies an `apikey` value by its public prefix so a format mismatch can be
 * reported in an error without echoing the key itself.
 *
 * Sending a secret key to a publishable-only endpoint (or a legacy
 * `anon` / `service_role` JWT to either) is a far more common mistake than a
 * genuinely wrong key, and the prefix is enough to tell them apart.
 *
 * @internal
 */
export function classifyApiKey(apikey: string | null): ApiKeyFormat {
  if (!apikey) return 'absent'
  if (apikey.startsWith('sb_publishable_')) return 'publishable'
  if (apikey.startsWith('sb_secret_')) return 'secret'
  // Legacy anon / service_role keys are unsigned-header JWTs, always "eyJ…".
  if (apikey.startsWith('eyJ')) return 'legacy-jwt'
  return 'unrecognized'
}
