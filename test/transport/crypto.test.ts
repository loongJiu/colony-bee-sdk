import { describe, it, expect } from 'vitest'
import { createHash, createHmac } from 'node:crypto'
import { signJoin, signNonce } from '../../src/transport/crypto.js'

describe('signJoin', () => {
  it('返回 SHA256 hex 字符串', () => {
    const result = signJoin('1234567890', 'my-token')
    const expected = createHash('sha256').update('1234567890my-token').digest('hex')
    expect(result).toBe(expected)
  })

  it('输出长度为 64 个字符', () => {
    expect(signJoin('ts', 'token')).toHaveLength(64)
  })

  it('不同输入产生不同输出', () => {
    expect(signJoin('ts1', 'token')).not.toBe(signJoin('ts2', 'token'))
  })
})

describe('signNonce', () => {
  it('返回 HMAC-SHA256 hex 字符串', () => {
    const result = signNonce('nonce123', 'secret')
    const expected = createHmac('sha256', 'secret').update('nonce123').digest('hex')
    expect(result).toBe(expected)
  })

  it('输出长度为 64 个字符', () => {
    expect(signNonce('n', 'key')).toHaveLength(64)
  })

  it('不同 nonce 产生不同输出', () => {
    expect(signNonce('a', 'key')).not.toBe(signNonce('b', 'key'))
  })
})
