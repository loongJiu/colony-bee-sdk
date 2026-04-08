import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { HeartbeatManager } from '../../src/protocol/heartbeat.js'
import { Logger } from '../../src/logger.js'

const logger = new Logger({ level: 'warn', output: { log: vi.fn(), warn: vi.fn(), error: vi.fn() } })

function createMockQueenClient() {
  return {
    heartbeat: vi.fn().mockResolvedValue({ ok: true }),
    join: vi.fn(),
    verify: vi.fn(),
    leave: vi.fn(),
    updateSpec: vi.fn()
  }
}

describe('HeartbeatManager', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('启动后定时发送心跳', async () => {
    const queen = createMockQueenClient()
    const hb = new HeartbeatManager(queen as any, { intervalMs: 1000 }, logger)
    const getStats = () => ({ activeTasks: 0, queueDepth: 0, load: 0 })

    hb.start('session-token', getStats)

    // 第一次立即发送
    await vi.advanceTimersByTimeAsync(0)
    expect(queen.heartbeat).toHaveBeenCalledTimes(1)

    // 1 秒后第二次
    await vi.advanceTimersByTimeAsync(1000)
    expect(queen.heartbeat).toHaveBeenCalledTimes(2)

    hb.stop()
  })

  it('stop() 停止发送', async () => {
    const queen = createMockQueenClient()
    const hb = new HeartbeatManager(queen as any, { intervalMs: 1000 }, logger)
    hb.start('token', () => ({ activeTasks: 0, queueDepth: 0, load: 0 }))

    await vi.advanceTimersByTimeAsync(0)
    hb.stop()

    await vi.advanceTimersByTimeAsync(5000)
    expect(queen.heartbeat).toHaveBeenCalledTimes(1) // 只有第一次
  })

  it('连续 3 次失败后 emit disconnected', async () => {
    const queen = createMockQueenClient()
    queen.heartbeat.mockRejectedValue(new Error('fail'))

    const hb = new HeartbeatManager(queen as any, { intervalMs: 1000 }, logger)
    const handler = vi.fn()
    hb.on('disconnected', handler)

    hb.start('token', () => ({ activeTasks: 0, queueDepth: 0, load: 0 }))

    // 第 1 次失败
    await vi.advanceTimersByTimeAsync(0)
    expect(handler).not.toHaveBeenCalled()

    // 第 2 次
    await vi.advanceTimersByTimeAsync(1000)
    expect(handler).not.toHaveBeenCalled()

    // 第 3 次 → emit
    await vi.advanceTimersByTimeAsync(1000)
    expect(handler).toHaveBeenCalledWith({ reason: 'heartbeat_failures' })

    hb.stop()
  })
})
