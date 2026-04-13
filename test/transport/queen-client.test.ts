import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { QueenClient } from '../../src/transport/queen-client.js'
import { Logger } from '../../src/logger.js'
import { UnauthorizedError, ConnectionError } from '../../src/errors.js'
import { CONTROL_PLANE_CONTRACT_VERSION } from '../../src/contracts/control-plane.js'

const logger = new Logger({ level: 'warn', output: { log: vi.fn(), warn: vi.fn(), error: vi.fn() } })

describe('QueenClient', () => {
  let client: QueenClient
  let fetchMock: ReturnType<typeof vi.fn>

  beforeEach(() => {
    client = new QueenClient('http://queen.test/', logger)
    fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('join 发送 POST /colony/join', async () => {
    fetchMock.mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ nonce: 'abc123', expiresAt: '2025-01-01' })
    })

    const result = await client.join({ identity: { role: 'worker', name: 'x' } } as any, 'ts', 'sig')

    expect(fetchMock).toHaveBeenCalledWith(
      'http://queen.test/colony/join',
      expect.objectContaining({ method: 'POST' })
    )
    const joinPayload = JSON.parse(fetchMock.mock.calls[0][1].body as string)
    expect(joinPayload.contract.version).toBe(CONTROL_PLANE_CONTRACT_VERSION)
    expect(result.nonce).toBe('abc123')
  })

  it('verify 发送 POST /colony/verify', async () => {
    fetchMock.mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ agent_id: 'a1', session_token: 'st', queen_id: 'q', colony_version: '1', joined_at: '' })
    })

    const result = await client.verify('nonce', 'signed')
    expect(result.agent_id).toBe('a1')
  })

  it('heartbeat 发送 POST /colony/heartbeat', async () => {
    fetchMock.mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ ok: true })
    })

    await client.heartbeat('token', { status: 'idle', load: 0, active_tasks: 0, queue_depth: 0 })
    expect(fetchMock).toHaveBeenCalledWith(
      'http://queen.test/colony/heartbeat',
      expect.objectContaining({ method: 'POST' })
    )
    const heartbeatPayload = JSON.parse(fetchMock.mock.calls[0][1].body as string)
    expect(heartbeatPayload.contract_version).toBe(CONTROL_PLANE_CONTRACT_VERSION)
  })

  it('leave 发送 POST /colony/leave', async () => {
    fetchMock.mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ ok: true })
    })

    await client.leave('token')
    expect(fetchMock).toHaveBeenCalledWith(
      'http://queen.test/colony/leave',
      expect.anything()
    )
  })

  it('401 响应抛 UnauthorizedError', async () => {
    fetchMock.mockResolvedValue({ ok: false, status: 401, json: async () => ({}) })

    await expect(client.join({} as any, '', '')).rejects.toThrow(UnauthorizedError)
  })

  it('5xx 响应抛 retryable ConnectionError', async () => {
    fetchMock.mockResolvedValue({ ok: false, status: 500, json: async () => ({ error: 'internal' }) })

    try {
      await client.join({} as any, '', '')
      expect.unreachable('should throw')
    } catch (err) {
      expect(err).toBeInstanceOf(ConnectionError)
      expect((err as ConnectionError).retryable).toBe(true)
    }
  })

  it('4xx 响应抛非 retryable ConnectionError', async () => {
    fetchMock.mockResolvedValue({ ok: false, status: 400, json: async () => ({ error: 'bad' }) })

    try {
      await client.join({} as any, '', '')
      expect.unreachable('should throw')
    } catch (err) {
      expect(err).toBeInstanceOf(ConnectionError)
      expect((err as ConnectionError).retryable).toBe(false)
    }
  })

  it('网络错误抛 retryable ConnectionError', async () => {
    fetchMock.mockRejectedValue(new TypeError('fetch fail'))

    await expect(client.join({} as any, '', '')).rejects.toThrow(ConnectionError)
  })

  it('响应契约主版本不兼容时抛 ConnectionError', async () => {
    fetchMock.mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ nonce: 'abc123', expiresAt: '2025-01-01', contract_version: '2.0.0' })
    })

    await expect(client.join({} as any, 'ts', 'sig')).rejects.toThrow('Incompatible control-plane contract version')
  })

  it('去除尾部斜杠', async () => {
    const c = new QueenClient('http://test.com///', logger)
    fetchMock.mockResolvedValue({ ok: true, status: 200, json: async () => ({}) })

    await c.leave('t')
    expect(fetchMock).toHaveBeenCalledWith(
      'http://test.com/colony/leave',
      expect.anything()
    )
  })
})
