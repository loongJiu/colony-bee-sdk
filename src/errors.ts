/**
 * 错误类和错误码
 *
 * 与 colony-queen 错误体系对齐
 */

export const ErrorCodes = {
  ERR_TIMEOUT: 'ERR_TIMEOUT',
  ERR_TASK_CANCELLED: 'ERR_TASK_CANCELLED',
  ERR_NO_HANDLER: 'ERR_NO_HANDLER',
  ERR_OVERLOADED: 'ERR_OVERLOADED',
  ERR_VALIDATION: 'ERR_VALIDATION',
  ERR_UNKNOWN: 'ERR_UNKNOWN',
  ERR_HANDSHAKE: 'ERR_HANDSHAKE',
  ERR_CONNECTION: 'ERR_CONNECTION',
  ERR_UNAUTHORIZED: 'ERR_UNAUTHORIZED'
} as const

export type ErrorCode = typeof ErrorCodes[keyof typeof ErrorCodes]

export class BeeError extends Error {
  override name: string = 'BeeError'
  readonly code: ErrorCode
  readonly retryable: boolean

  constructor(message: string, code: ErrorCode = ErrorCodes.ERR_UNKNOWN, retryable = false) {
    super(message)
    this.code = code
    this.retryable = retryable
  }

  toJSON(): { code: ErrorCode; message: string; retryable: boolean } {
    return { code: this.code, message: this.message, retryable: this.retryable }
  }
}

export class HandshakeError extends BeeError {
  override name = 'HandshakeError'

  constructor(message: string) {
    super(message, ErrorCodes.ERR_HANDSHAKE, false)
  }
}

export class ConnectionError extends BeeError {
  override name = 'ConnectionError'

  constructor(message: string, retryable = true) {
    super(message, ErrorCodes.ERR_CONNECTION, retryable)
  }
}

export class UnauthorizedError extends BeeError {
  override name = 'UnauthorizedError'

  constructor(message: string) {
    super(message, ErrorCodes.ERR_UNAUTHORIZED, false)
  }
}

export class TaskError extends BeeError {
  override name = 'TaskError'

  constructor(message: string, code: ErrorCode = ErrorCodes.ERR_UNKNOWN, retryable = false) {
    super(message, code, retryable)
  }
}

export class TimeoutError extends TaskError {
  override name = 'TimeoutError'

  constructor(message: string) {
    super(message, ErrorCodes.ERR_TIMEOUT, true)
  }
}
