export class EnvError extends Error {
  readonly status = 500
  readonly code: string

  constructor(message: string, code = 'ENV_ERROR') {
    super(message)
    this.name = 'EnvError'
    this.code = code
  }
}

export class AuthError extends Error {
  readonly status: number
  readonly code: string

  constructor(message: string, code = 'AUTH_ERROR', status = 401) {
    super(message)
    this.name = 'AuthError'
    this.code = code
    this.status = status
  }
}
