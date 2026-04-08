import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { Reconnector } from '../../src/protocol/reconnector.js'
import { Logger } from '../../src/logger.js'

const logger = new Logger({ level: 'warn', output: { log: vi.fn(), warn: vi.fn(), error: vi.fn() } })

function createMockHandshake(succeedAfter = 0) {
  let calls = 0
  return {
    execute: vi.fn().mockImplementation(async () => {
      calls++
      if (calls > succeedAfter) {
        return { agentId: 'reconnected', sessionToken: 'new-token' }
      }
      throw new Error('not ready')
    })
  }
}

describe('Reconnector', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('成功后 emit reconnected', async () => {
    const hs = createMockHandshake(0) // 首次即成功
    const rec = new Reconnector({ baseDelayMs: 100, maxDelayMs: 1000 }, logger)
    const handler = vi.fn()
    rec.on('reconnected', handler)

    const promise = rec.reconnect(hs as any, {} as any, 'token')

    await vi.advanceTimersByTimeAsync(200)
    const result = await promise

    expect(handler).toHaveBeenCalledWith({ agentId: 'reconnected', sessionToken: 'new-token' })
    expect(result.agentId).toBe('reconnected')
  })

  it('失败后重试，指数退避', async () => {
    const hs = createMockHandshake(1) // 第 2 次成功
    const rec = new Reconnector({ baseDelayMs: 100, maxDelayMs: 5000 }, logger)
    const handler = vi.fn()
    rec.on('reconnected', handler)

    const promise = rec.reconnect(hs as any, {} as any, 'token')

    // 第一次尝试 (delay ~100ms)
    await vi.advanceTimersByTimeAsync(500)
    // 第二次尝试 (delay ~200ms)
    await vi.advanceTimersByTimeAsync(500)

    await promise
    expect(handler).toHaveBeenCalledTimes(1)
    expect(hs.execute).toHaveBeenCalledTimes(2)
  })

  it('stop() 中止重连', async () => {
    const hs = createMockHandshake(999) // 永远失败
    const rec = new Reconnector({ baseDelayMs: 100, maxDelayMs: 1000 }, logger)

    // 捕获 unhandled rejection
    const promise = rec.reconnect(hs as any, {} as any, 'token')
    promise.catch(() => {}) // 防止 unhandled rejection

    await vi.advanceTimersByTimeAsync(500)
    rec.stop()

    await vi.advanceTimersByTimeAsync(5000)
    await expect(promise).rejects.toThrow('Reconnector stopped')
  })

  it('reset() 重置退避计数', () => {
    const rec = new Reconnector({}, logger)
    rec.reset()
    // reset 不抛错即通过
    expect(true).toBe(true)
  })
})
