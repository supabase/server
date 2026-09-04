import { errorResponse } from '../../error-response.js'
import { AuthError, EnvError } from '../../errors.js'
import type { ErrorResponseConfig } from '../../types.js'

const constructionFailure = Symbol.for('@supabase/server:constructionFailure')

/**
 * Marks an error thrown while a Supabase client is constructed for the
 * request. `withSupabase`'s boundary maps only marked errors to a JSON
 * response; any other throw escaping a part or the handler propagates.
 *
 * The mark is a non-enumerable symbol property, so the error's class, own
 * properties and `toJSON` payload are unchanged.
 */
export function markConstructionFailure<E extends Error>(error: E): E {
  Object.defineProperty(error, constructionFailure, { value: true })
  return error
}

/** True for an `EnvError` or `AuthError` carrying the construction mark. */
export function isConstructionFailure(
  error: unknown,
): error is EnvError | AuthError {
  return (
    (error instanceof EnvError || error instanceof AuthError) &&
    constructionFailure in error
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
