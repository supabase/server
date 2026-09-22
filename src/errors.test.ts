import { describe, expect, it } from 'vitest'

import {
  AuthError,
  EnvError,
  Errors,
  ErrorSource,
  InvalidCredentialsError,
  MissingDefaultSecretKeyError,
  MissingSecretKeyError,
  MissingSupabaseURLError,
  PostgresConnectPausedError,
  PostgresPoolBusyError,
  PostgresPoolError,
  SupabaseServerError,
} from './errors.js'

describe('SupabaseServerError', () => {
  it('is the common base for every error class', () => {
    const pool = new PostgresPoolError('nope', PostgresPoolBusyError)
    expect(new AuthError('nope')).toBeInstanceOf(SupabaseServerError)
    expect(new EnvError('nope')).toBeInstanceOf(SupabaseServerError)
    expect(pool).toBeInstanceOf(SupabaseServerError)
    // Still ordinary Errors, so existing `instanceof Error` checks hold.
    expect(new AuthError('nope')).toBeInstanceOf(Error)
    expect(new EnvError('nope')).toBeInstanceOf(Error)
    expect(pool).toBeInstanceOf(Error)
  })

  it('keeps the subclasses distinguishable', () => {
    const pool = new PostgresPoolError('nope', PostgresPoolBusyError)
    expect(new AuthError('nope')).not.toBeInstanceOf(EnvError)
    expect(new EnvError('nope')).not.toBeInstanceOf(AuthError)
    expect(pool).not.toBeInstanceOf(AuthError)
    expect(pool).not.toBeInstanceOf(EnvError)
    expect(new AuthError('nope').name).toBe('AuthError')
    expect(new EnvError('nope').name).toBe('EnvError')
    expect(pool.name).toBe('PostgresPoolError')
  })

  it('stamps provenance on the message and as a field', () => {
    const error = new AuthError('something went wrong')
    expect(error.source).toBe(ErrorSource)
    expect(error.message).toBe('[@supabase/server] something went wrong')
  })

  it('does not double-prefix an already-prefixed message', () => {
    const once = new AuthError('boom')
    const rewrapped = new AuthError(once.message, once.code, once.status)
    expect(rewrapped.message).toBe('[@supabase/server] boom')
  })

  it('derives a docs URL from the code', () => {
    expect(new AuthError('boom', 'SOME_CODE').docs).toBe(
      'https://github.com/supabase/server/blob/main/docs/error-handling.md#some_code',
    )
  })

  it('honours an explicit docs override', () => {
    const error = new AuthError('boom', 'SOME_CODE', 401, {
      docs: 'https://example.com/x',
    })
    expect(error.docs).toBe('https://example.com/x')
  })

  it('omits absent optional fields from toJSON', () => {
    const payload = new AuthError('boom', 'SOME_CODE').toJSON()
    expect(payload).toEqual({
      source: ErrorSource,
      code: 'SOME_CODE',
      message: '[@supabase/server] boom',
      docs: expect.any(String),
    })
    expect('hint' in payload).toBe(false)
    expect('details' in payload).toBe(false)
  })

  it('serializes via JSON.stringify instead of collapsing to {}', () => {
    const error = new AuthError('boom', 'SOME_CODE', 401, {
      hint: 'try this',
      details: { mode: 'user' },
    })
    expect(JSON.parse(JSON.stringify(error))).toEqual({
      source: ErrorSource,
      code: 'SOME_CODE',
      message: '[@supabase/server] boom',
      hint: 'try this',
      docs: expect.any(String),
      details: { mode: 'user' },
    })
  })

  it('retains the underlying cause when wrapping', () => {
    const inner = new Error('inner')
    expect(new AuthError('outer', 'X', 500, { cause: inner }).cause).toBe(inner)
  })
})

describe('EnvError', () => {
  it('is always a 500', () => {
    expect(new EnvError('boom').status).toBe(500)
  })

  it('defaults to the generic code', () => {
    expect(new EnvError('boom').code).toBe('ENV_ERROR')
  })
})

describe('PostgresPoolError', () => {
  it('is always a 503', () => {
    expect(new PostgresPoolError('nope', PostgresPoolBusyError).status).toBe(
      503,
    )
  })
})

describe('AuthError', () => {
  it('defaults to a 401 with the generic code', () => {
    const error = new AuthError('boom')
    expect(error.status).toBe(401)
    expect(error.code).toBe('AUTH_ERROR')
  })
})

describe('Errors factory map', () => {
  it('produces an actionable EnvError for a missing URL', () => {
    const error = Errors[MissingSupabaseURLError]()
    expect(error.status).toBe(500)
    expect(error.code).toBe(MissingSupabaseURLError)
    expect(error.hint).toContain('SUPABASE_URL')
    expect(error.docs).toContain('#missing_supabase_url')
  })

  it('reports which key names are configured, never their values', () => {
    const error = Errors[MissingSecretKeyError]('mobile', ['default', 'web'])
    expect(error.message).toContain('"default", "web"')
    expect(error.hint).toContain('SUPABASE_SECRET_KEYS')
    expect(error.details).toMatchObject({
      requestedKeyName: 'mobile',
      configuredKeyNames: ['default', 'web'],
    })
  })

  it('says so plainly when nothing is configured', () => {
    expect(Errors[MissingDefaultSecretKeyError]([]).message).toContain(
      'None are configured.',
    )
  })

  it('still supports the zero-argument legacy signatures', () => {
    expect(Errors[MissingSecretKeyError]('mobile').code).toBe(
      MissingSecretKeyError,
    )
    expect(Errors[MissingDefaultSecretKeyError]().code).toBe(
      MissingDefaultSecretKeyError,
    )
    expect(Errors[InvalidCredentialsError]().code).toBe(InvalidCredentialsError)
    expect(Errors[InvalidCredentialsError]().status).toBe(401)
  })

  it('describes a paused pool with the time left and the failure behind it', () => {
    const failure = new Error(
      'password authentication failed for user "postgres"',
    )
    const error = Errors[PostgresConnectPausedError]({
      remainingMs: 1500,
      cause: failure,
    })
    expect(error).toBeInstanceOf(PostgresPoolError)
    expect(error.code).toBe('POSTGRES_CONNECT_PAUSED')
    expect(error.status).toBe(503)
    expect(error.message).toBe(
      '[@supabase/server] postgres pool: new connections paused for 1500ms after a connection failure: password authentication failed for user "postgres"',
    )
    expect(error.cause).toBe(failure)
    expect(error.details).toEqual({ retryAfterMs: 1500 })
    expect(error.hint).toMatch(/connection string/)
    expect(error.docs).toContain('#postgres_connect_paused')
  })

  it('renders a non-Error cause by its string form', () => {
    const error = Errors[PostgresConnectPausedError]({
      remainingMs: 1,
      cause: 'socket hang up',
    })
    expect(error.message).toMatch(/connection failure: socket hang up$/)
  })

  it('describes a busy pool with its size and the wait', () => {
    const error = Errors[PostgresPoolBusyError]({ max: 4, waitedMs: 10_000 })
    expect(error).toBeInstanceOf(PostgresPoolError)
    expect(error.code).toBe('POSTGRES_POOL_BUSY')
    expect(error.status).toBe(503)
    expect(error.message).toBe(
      '[@supabase/server] postgres pool: all 4 connections stayed busy for 10000ms',
    )
    expect(error.details).toEqual({ max: 4, waitedMs: 10_000 })
    expect(error.hint).toMatch(/ctx\.supabase/)
    expect(error.docs).toContain('#postgres_pool_busy')
  })
})
