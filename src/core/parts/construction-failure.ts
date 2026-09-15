import { errorResponse } from '../../error-response.js'
import { AuthError, EnvError } from '../../errors.js'
import type { ErrorResponseConfig } from '../../types.js'

const constructionFailure = Symbol.for('@supabase/server:constructionFailure')

/**
 * The boundary a construction failure belongs to. `withSupabase`'s boundary
 * answers `supabase` failures and `withOAuthProtectedResource` answers
 * `oauthProtectedResource` failures. Each ignores the other's, so an error one
 * of them marks and a handler under the other rethrows still propagates.
 */
export type ConstructionScope = 'supabase' | 'oauthProtectedResource'

/**
 * Marks an error the library raises while building what a middleware
 * contributes to the request: the Supabase clients under `withSupabase`, the
 * URLs `withOAuthProtectedResource` advertises. A boundary maps only errors
 * marked with its own scope to a JSON response; any other throw escaping a
 * part, a configured callback or the handler propagates.
 *
 * The mark is a non-enumerable symbol property, so the error's class, own
 * properties and `toJSON` payload are unchanged.
 */
export function markConstructionFailure<E extends Error>(
  error: E,
  scope: ConstructionScope,
): E {
  Object.defineProperty(error, constructionFailure, { value: scope })
  return error
}

/**
 * True for an `EnvError` or `AuthError` carrying the construction mark for
 * `scope`.
 */
export function isConstructionFailure(
  error: unknown,
  scope: ConstructionScope,
): error is EnvError | AuthError {
  return (
    (error instanceof EnvError || error instanceof AuthError) &&
    (error as { [constructionFailure]?: unknown })[constructionFailure] ===
      scope
  )
}

/**
 * The JSON response for a construction failure: the error's own code, status,
 * hint, details and docs, rendered exactly as `errorResponse` renders any
 * other {@link SupabaseServerError}.
 */
export function constructionFailureResponse(
  error: EnvError | AuthError,
  errors?: ErrorResponseConfig,
): Response {
  return errorResponse(error, { errors })
}
