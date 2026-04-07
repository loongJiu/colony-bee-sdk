/**
 * 错误类和错误码
 *
 * 与 colony-queen 错误体系对齐
 */

/**
 * SDK 错误码
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
}

/**
 * SDK 基础错误类
 */
export class BeeError extends Error {
  /** @type {string} */
  code
  /** @type {boolean} */
  retryable

  /**
   * @param {string} message
   * @param {string} [code]
   * @param {boolean} [retryable]
   */
  constructor(message, code = ErrorCodes.ERR_UNKNOWN, retryable = false) {
    super(message)
    this.name = 'BeeError'
    this.code = code
    this.retryable = retryable
  }

  toJSON() {
    return { code: this.code, message: this.message, retryable: this.retryable }
  }
}

/**
 * 握手失败
 */
export class HandshakeError extends BeeError {
  constructor(message) {
    super(message, ErrorCodes.ERR_HANDSHAKE, false)
    this.name = 'HandshakeError'
  }
}

/**
 * 连接错误
 */
export class ConnectionError extends BeeError {
  constructor(message, retryable = true) {
    super(message, ErrorCodes.ERR_CONNECTION, retryable)
    this.name = 'ConnectionError'
  }
}

/**
 * 认证失败
 */
export class UnauthorizedError extends BeeError {
  constructor(message) {
    super(message, ErrorCodes.ERR_UNAUTHORIZED, false)
    this.name = 'UnauthorizedError'
  }
}

/**
 * 任务执行错误
 */
export class TaskError extends BeeError {
  constructor(message, code = ErrorCodes.ERR_UNKNOWN, retryable = false) {
    super(message, code, retryable)
    this.name = 'TaskError'
  }
}

/**
 * 超时错误
 */
export class TimeoutError extends TaskError {
  constructor(message) {
    super(message, ErrorCodes.ERR_TIMEOUT, true)
    this.name = 'TimeoutError'
  }
}
