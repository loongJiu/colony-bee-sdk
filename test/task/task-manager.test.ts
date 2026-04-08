import { describe, it, expect, vi, beforeEach } from 'vitest'
import { TaskManager } from '../../src/task/task-manager.js'
import { ToolRegistry } from '../../src/task/tool-registry.js'
import { SkillRegistry } from '../../src/skill-registry.js'
import { Logger } from '../../src/logger.js'
import { ErrorCodes } from '../../src/errors.js'

function createManager(opts: Partial<ConstructorParameters<typeof TaskManager>[0]> = {}) {
  return new TaskManager({
    maxConcurrent: opts.maxConcurrent ?? 1,
    defaultTimeoutSec: opts.defaultTimeoutSec ?? 30,
    queueMax: opts.queueMax ?? 100,
    toolRegistry: opts.toolRegistry ?? new ToolRegistry(),
    skillRegistry: opts.skillRegistry ?? new SkillRegistry(),
    modelCaller: opts.modelCaller ?? null,
    logger: opts.logger ?? new Logger({ level: 'warn', output: { log: vi.fn(), warn: vi.fn(), error: vi.fn() } })
  })
}

describe('TaskManager', () => {
  it('注册 handler 并成功执行任务', async () => {
    const mgr = createManager()
    mgr.registerHandler('code_generation', async (ctx) => ({ code: 'hello' }))

    const result = await mgr.handleTaskAssign({
      task: { task_id: 't1', name: 'code_generation', input: 'test' }
    })

    expect(result.status).toBe('success')
    expect((result as { output: unknown }).output).toEqual({ code: 'hello' })
  })

  it('无 handler 时返回 failure + ERR_NO_HANDLER', async () => {
    const mgr = createManager()
    const result = await mgr.handleTaskAssign({
      task: { task_id: 't1', name: 'unknown_cap' }
    })

    expect(result.status).toBe('failure')
    expect((result as { error: { code: string } }).error.code).toBe(ErrorCodes.ERR_NO_HANDLER)
  })

  it('并发超限时返回 ERR_OVERLOADED', async () => {
    const mgr = createManager({ maxConcurrent: 1 })
    mgr.registerHandler('cap', async () => {
      await new Promise((r) => setTimeout(r, 100))
      return 'done'
    })

    // 启动第一个任务（不 await）
    const first = mgr.handleTaskAssign({
      task: { task_id: 't1', name: 'cap' }
    })

    // 第二个任务应被拒绝
    const result = await mgr.handleTaskAssign({
      task: { task_id: 't2', name: 'cap' }
    })

    expect(result.status).toBe('failure')
    expect((result as { error: { code: string } }).error.code).toBe(ErrorCodes.ERR_OVERLOADED)

    await first
  })

  it('超时返回 ERR_TIMEOUT', async () => {
    vi.useFakeTimers()
    const mgr = createManager({ defaultTimeoutSec: 1 })
    mgr.registerHandler('cap', async (ctx) => {
      // 监听 abort 事件让 promise 得以 settle
      return new Promise((_, reject) => {
        ctx.signal.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError')))
      })
    })

    const promise = mgr.handleTaskAssign({
      task: { task_id: 't1', name: 'cap' }
    })

    vi.advanceTimersByTime(1500)
    const result = await promise

    expect(result.status).toBe('failure')
    expect((result as { error: { code: string } }).error.code).toBe(ErrorCodes.ERR_TIMEOUT)

    vi.useRealTimers()
  })

  it('handleTaskCancel 中止任务', async () => {
    vi.useFakeTimers()
    const mgr = createManager({ defaultTimeoutSec: 60 })
    let aborted = false
    mgr.registerHandler('cap', async (ctx) => {
      return new Promise((_, reject) => {
        ctx.signal.addEventListener('abort', () => {
          aborted = true
          reject(new Error('cancelled'))
        })
      })
    })

    const promise = mgr.handleTaskAssign({
      task: { task_id: 't1', name: 'cap' }
    })

    await vi.advanceTimersByTimeAsync(10)
    mgr.handleTaskCancel({ task_id: 't1' })

    const result = await promise
    expect(aborted).toBe(true)
    expect(result.status).toBe('failure')
    expect((result as { error: { code: string } }).error.code).toBe(ErrorCodes.ERR_TASK_CANCELLED)

    vi.useRealTimers()
  })

  it('getStats 返回正确统计', () => {
    const mgr = createManager({ maxConcurrent: 2 })
    const stats = mgr.getStats()
    expect(stats).toEqual({ activeTasks: 0, queueDepth: 0, load: 0 })
  })

  it('setModelCaller 传递给 TaskContext', async () => {
    const caller = vi.fn().mockResolvedValue('model-response')
    const mgr = createManager()
    mgr.setModelCaller(caller)
    mgr.registerHandler('cap', async (ctx) => {
      return ctx.callModel('test')
    })

    const result = await mgr.handleTaskAssign({
      task: { task_id: 't1', name: 'cap' }
    })

    expect(result.status).toBe('success')
    expect(caller).toHaveBeenCalledWith('test', undefined)
  })

  it('handler 抛错时返回 failure', async () => {
    const mgr = createManager()
    mgr.registerHandler('cap', async () => {
      throw new Error('boom')
    })

    const result = await mgr.handleTaskAssign({
      task: { task_id: 't1', name: 'cap' }
    })

    expect(result.status).toBe('failure')
    expect((result as { error: { message: string } }).error.message).toBe('boom')
  })

  it('无 task 字段时使用默认值', async () => {
    const mgr = createManager()
    mgr.registerHandler('cap', async (ctx) => ctx.taskId)

    const result = await mgr.handleTaskAssign({})
    // 没有匹配的 capability name，但会用 fallback handler
    expect(result.status).toBe('success')
  })
})
