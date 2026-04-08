import { describe, it, expect, vi } from 'vitest'
import { Handshake } from '../../src/protocol/handshake.js'
import { HandshakeError } from '../../src/errors.js'
import { Logger } from '../../src/logger.js'
import type { BeeSpec } from '../../src/spec-loader.js'

const logger = new Logger({ level: 'warn', output: { log: vi.fn(), warn: vi.fn(), error: vi.fn() } })
const mockSpec = { identity: { role: 'worker' as const, name: 'test' }, capabilities: ['a'] } as BeeSpec

function createMockQueenClient(joinResult?: any, verifyResult?: any) {
  return {
    join: vi.fn().mockResolvedValue(joinResult ?? { nonce: 'nonce123', expiresAt: '' }),
    verify: vi.fn().mockResolvedValue(verifyResult ?? { agent_id: 'agent1', session_token: 'token1', queen_id: 'q', colony_version: '1', joined_at: '' }),
    heartbeat: vi.fn(),
    leave: vi.fn(),
    updateSpec: vi.fn()
  }
}

describe('Handshake', () => {
  it('完整握手成功', async () => {
    const queen = createMockQueenClient()
    const hs = new Handshake(queen as any, logger)

    const result = await hs.execute(mockSpec, 'colony-token')

    expect(result.agentId).toBe('agent1')
    expect(result.sessionToken).toBe('token1')
    expect(queen.join).toHaveBeenCalledTimes(1)
    expect(queen.verify).toHaveBeenCalledTimes(1)
  })

  it('join 失败抛 HandshakeError', async () => {
    const queen = createMockQueenClient()
    queen.join.mockRejectedValue(new Error('network'))

    const hs = new Handshake(queen as any, logger)
    await expect(hs.execute(mockSpec, 'token')).rejects.toThrow(HandshakeError)
  })

  it('challenge 返回空 nonce 抛 HandshakeError', async () => {
    const queen = createMockQueenClient({ nonce: '', expiresAt: '' })

    const hs = new Handshake(queen as any, logger)
    await expect(hs.execute(mockSpec, 'token')).rejects.toThrow('missing nonce')
  })

  it('verify 失败抛 HandshakeError', async () => {
    const queen = createMockQueenClient()
    queen.verify.mockRejectedValue(new Error('denied'))

    const hs = new Handshake(queen as any, logger)
    await expect(hs.execute(mockSpec, 'token')).rejects.toThrow(HandshakeError)
  })

  it('welcome 缺少 agent_id 抛 HandshakeError', async () => {
    const queen = createMockQueenClient(undefined, { session_token: 'st', queen_id: 'q', colony_version: '1', joined_at: '' })

    const hs = new Handshake(queen as any, logger)
    await expect(hs.execute(mockSpec, 'token')).rejects.toThrow('missing agent_id or session_token')
  })

  it('welcome 缺少 session_token 抛 HandshakeError', async () => {
    const queen = createMockQueenClient(undefined, { agent_id: 'a1', queen_id: 'q', colony_version: '1', joined_at: '' })

    const hs = new Handshake(queen as any, logger)
    await expect(hs.execute(mockSpec, 'token')).rejects.toThrow('missing agent_id or session_token')
  })
})
