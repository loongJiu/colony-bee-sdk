import { describe, it, expect } from 'vitest'
import {
  BeeError,
  HandshakeError,
  ConnectionError,
  UnauthorizedError,
  TaskError,
  TimeoutError,
  ErrorCodes
} from '../src/errors.js'

describe('ErrorCodes', () => {
  it('包含所有错误码', () => {
    expect(ErrorCodes.ERR_TIMEOUT).toBe('ERR_TIMEOUT')
    expect(ErrorCodes.ERR_TASK_CANCELLED).toBe('ERR_TASK_CANCELLED')
    expect(ErrorCodes.ERR_NO_HANDLER).toBe('ERR_NO_HANDLER')
    expect(ErrorCodes.ERR_OVERLOADED).toBe('ERR_OVERLOADED')
    expect(ErrorCodes.ERR_VALIDATION).toBe('ERR_VALIDATION')
    expect(ErrorCodes.ERR_UNKNOWN).toBe('ERR_UNKNOWN')
    expect(ErrorCodes.ERR_HANDSHAKE).toBe('ERR_HANDSHAKE')
    expect(ErrorCodes.ERR_CONNECTION).toBe('ERR_CONNECTION')
    expect(ErrorCodes.ERR_UNAUTHORIZED).toBe('ERR_UNAUTHORIZED')
  })
})

describe('BeeError', () => {
  it('构造时设置 message、code、retryable', () => {
    const err = new BeeError('test', ErrorCodes.ERR_UNKNOWN, true)
    expect(err.message).toBe('test')
    expect(err.code).toBe('ERR_UNKNOWN')
    expect(err.retryable).toBe(true)
    expect(err.name).toBe('BeeError')
  })

  it('默认值', () => {
    const err = new BeeError('msg')
    expect(err.code).toBe('ERR_UNKNOWN')
    expect(err.retryable).toBe(false)
  })

  it('toJSON() 返回结构化数据', () => {
    const err = new BeeError('msg', ErrorCodes.ERR_TIMEOUT, true)
    expect(err.toJSON()).toEqual({
      code: 'ERR_TIMEOUT',
      message: 'msg',
      retryable: true
    })
  })

  it('是 Error 的实例', () => {
    expect(new BeeError('x')).toBeInstanceOf(Error)
  })
})

describe('HandshakeError', () => {
  it('code 为 ERR_HANDSHAKE，不可重试', () => {
    const err = new HandshakeError('bad handshake')
    expect(err.code).toBe('ERR_HANDSHAKE')
    expect(err.retryable).toBe(false)
    expect(err.name).toBe('HandshakeError')
    expect(err).toBeInstanceOf(BeeError)
  })
})

describe('ConnectionError', () => {
  it('code 为 ERR_CONNECTION，默认可重试', () => {
    const err = new ConnectionError('conn fail')
    expect(err.code).toBe('ERR_CONNECTION')
    expect(err.retryable).toBe(true)
    expect(err).toBeInstanceOf(BeeError)
  })

  it('可指定 retryable', () => {
    const err = new ConnectionError('fail', false)
    expect(err.retryable).toBe(false)
  })
})

describe('UnauthorizedError', () => {
  it('code 为 ERR_UNAUTHORIZED，不可重试', () => {
    const err = new UnauthorizedError('no auth')
    expect(err.code).toBe('ERR_UNAUTHORIZED')
    expect(err.retryable).toBe(false)
    expect(err).toBeInstanceOf(BeeError)
  })
})

describe('TaskError', () => {
  it('默认 code 为 ERR_UNKNOWN', () => {
    const err = new TaskError('task fail')
    expect(err.code).toBe('ERR_UNKNOWN')
    expect(err.retryable).toBe(false)
    expect(err).toBeInstanceOf(BeeError)
  })
})

describe('TimeoutError', () => {
  it('code 为 ERR_TIMEOUT，可重试', () => {
    const err = new TimeoutError('timed out')
    expect(err.code).toBe('ERR_TIMEOUT')
    expect(err.retryable).toBe(true)
    expect(err.name).toBe('TimeoutError')
    expect(err).toBeInstanceOf(TaskError)
    expect(err).toBeInstanceOf(BeeError)
  })
})
