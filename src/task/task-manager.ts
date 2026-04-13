/**
 * 任务生命周期管理
 *
 * 管理任务执行的全生命周期，处理并发控制、优先级队列、超时和取消
 */

import { TaskContext } from './task-context.js'
import { ErrorCodes, type ErrorCode } from '../errors.js'
import { Logger } from '../logger.js'
import { ToolRegistry } from './tool-registry.js'
import { SkillRegistry } from '../skill-registry.js'
import type { TaskHandler, ModelCaller, StreamingModelCaller, TaskAssignPayload, HeartbeatStats, StructuredTaskResult, QueueStrategy, TaskPriority, TaskResult } from '../types.js'

interface QueuedTask {
  payload: TaskAssignPayload
  priority: TaskPriority
  enqueuedAt: number
  resolve: (result: TaskResult) => void
}

const PRIORITY_ORDER: Record<TaskPriority, number> = { high: 0, normal: 1, low: 2 }

export class TaskManager {
  readonly #handlers: Map<string, TaskHandler> = new Map()
  readonly #activeControllers: Map<string, AbortController> = new Map()
  readonly #queue: QueuedTask[] = []
  readonly #maxConcurrent: number
  readonly #defaultTimeoutSec: number
  readonly #queueMax: number
  readonly #queueStrategy: QueueStrategy
  readonly #devMode: boolean
  readonly #logger: Logger
  readonly #toolRegistry: ToolRegistry
  readonly #skillRegistry: SkillRegistry
  #modelCaller: ModelCaller | null
  #streamingModelCaller: StreamingModelCaller | null
  readonly #baseLogger: Logger

  constructor(options: {
    maxConcurrent?: number
    defaultTimeoutSec?: number
    queueMax?: number
    queueStrategy?: QueueStrategy
    devMode?: boolean
    toolRegistry: ToolRegistry
    skillRegistry: SkillRegistry
    modelCaller?: ModelCaller | null
    streamingModelCaller?: StreamingModelCaller | null
    logger: Logger
  }) {
    this.#maxConcurrent = options.maxConcurrent ?? 1
    this.#defaultTimeoutSec = options.defaultTimeoutSec ?? 30
    this.#queueMax = options.queueMax ?? 100
    this.#queueStrategy = options.queueStrategy ?? 'fifo'
    this.#devMode = options.devMode ?? false
    this.#toolRegistry = options.toolRegistry
    this.#skillRegistry = options.skillRegistry
    this.#modelCaller = options.modelCaller ?? null
    this.#streamingModelCaller = options.streamingModelCaller ?? null
    this.#baseLogger = options.logger
    this.#logger = options.logger.child({ component: 'task-manager' })
  }

  /** 设置模型调用器 */
  setModelCaller(fn: ModelCaller): void {
    this.#modelCaller = fn
  }

  /** 设置流式模型调用器 */
  setStreamingModelCaller(fn: StreamingModelCaller): void {
    this.#streamingModelCaller = fn
  }

  /** 注册 capability handler */
  registerHandler(capability: string, handler: TaskHandler): void {
    this.#handlers.set(capability, handler)
  }

  /** 根据 capability 精确查找 handler */
  #resolveHandler(capability: string): TaskHandler | null {
    return this.#handlers.get(capability) ?? null
  }

  /** 处理任务分配请求 */
  handleTaskAssign(payload: TaskAssignPayload): Promise<TaskResult> {
    const task = payload.task ?? {}
    const context = payload.context ?? {}
    const taskId = task.task_id ?? 'unknown'
    const capability = task.name ?? task.description ?? ''
    const timeoutSec = task.constraints?.timeout ?? this.#defaultTimeoutSec

    const handler = this.#resolveHandler(capability)

    if (!handler) {
      return Promise.resolve({
        status: 'failure',
        error: {
          code: ErrorCodes.ERR_NO_HANDLER,
          message: `No handler registered for capability: ${capability}`,
          retryable: false
        }
      })
    }

    // 并发检查：有空闲槽位直接执行
    if (this.#activeControllers.size < this.#maxConcurrent) {
      return this.#executeTask(payload, handler, timeoutSec)
    }

    // 队列已满则拒绝
    if (this.#queue.length >= this.#queueMax) {
      return Promise.resolve({
        status: 'failure',
        error: {
          code: ErrorCodes.ERR_OVERLOADED,
          message: `Agent overloaded: ${this.#activeControllers.size}/${this.#maxConcurrent} tasks active, queue full (${this.#queue.length}/${this.#queueMax})`,
          retryable: true
        }
      })
    }

    // 入队等待
    const priority = (context as Record<string, unknown>).priority as TaskPriority ?? 'normal'
    this.#logger.info(`Queuing task ${taskId} (priority: ${priority}, queue: ${this.#queue.length})`)

    return new Promise<TaskResult>((resolve) => {
      this.#queue.push({ payload, priority, enqueuedAt: Date.now(), resolve })
      this.#sortQueue()
    })
  }

  /** 排序队列 */
  #sortQueue(): void {
    if (this.#queueStrategy === 'priority') {
      this.#queue.sort((a, b) => PRIORITY_ORDER[a.priority] - PRIORITY_ORDER[b.priority])
    }
    // fifo: 保持插入顺序（默认）
  }

  /** 从队列中取出下一个任务执行 */
  async #drainQueue(): Promise<void> {
    if (this.#queue.length === 0) return
    if (this.#activeControllers.size >= this.#maxConcurrent) return

    const next = this.#queue.shift()!
    const task = next.payload.task ?? {}
    const capability = task.name ?? task.description ?? ''
    const timeoutSec = task.constraints?.timeout ?? this.#defaultTimeoutSec

    const handler = this.#resolveHandler(capability)

    if (!handler) {
      next.resolve({ status: 'failure', error: { code: ErrorCodes.ERR_NO_HANDLER, message: `No handler for capability: ${capability}`, retryable: false } })
      return
    }

    const result = await this.#executeTask(next.payload, handler, timeoutSec)
    next.resolve(result)
  }

  /** 执行任务 */
  async #executeTask(payload: TaskAssignPayload, handler: TaskHandler, timeoutSec: number): Promise<TaskResult> {
    const task = payload.task ?? {}
    const context = payload.context ?? {}
    const taskId = task.task_id ?? 'unknown'
    const capability = task.name ?? task.description ?? ''

    const abortController = new AbortController()
    this.#activeControllers.set(taskId, abortController)

    const timeoutMs = timeoutSec * 1000
    let timedOut = false
    const timer = setTimeout(() => {
      timedOut = true
      abortController.abort()
    }, timeoutMs)

    const startedAt = Date.now()

    try {
      const ctx = new TaskContext({
        taskId,
        capability,
        input: task.input,
        signal: abortController.signal,
        conversationId: context.conversation_id,
        sharedState: context.shared_state,
        toolRegistry: this.#toolRegistry,
        skillRegistry: this.#skillRegistry,
        modelCaller: this.#modelCaller,
        streamingModelCaller: this.#streamingModelCaller,
        logger: this.#baseLogger
      })

      this.#logger.info(`Executing task ${taskId} (timeout: ${timeoutSec}s)`)

      if (this.#devMode) {
        this.#logger.debug(`[devMode] Task ${taskId} input: ${JSON.stringify(task.input)}`)
      }

      const output = await handler(ctx)

      clearTimeout(timer)

      if (this.#devMode) {
        this.#logger.debug(`[devMode] Task ${taskId} output: ${JSON.stringify(output)}`)
        const meta = ctx.getMetadata()
        if (meta.toolsInvoked.length > 0) {
          this.#logger.debug(`[devMode] Task ${taskId} tools invoked: ${meta.toolsInvoked.join(', ')}`)
        }
      }

      if (timedOut) {
        return {
          status: 'failure',
          error: {
            code: ErrorCodes.ERR_TIMEOUT,
            message: `Task timed out after ${timeoutSec}s`,
            retryable: true
          }
        }
      }

      const latencyMs = Date.now() - startedAt
      this.#logger.info(`Task ${taskId} completed in ${latencyMs}ms`)

      // 识别 StructuredTaskResult 格式（含 data 字段）
      if (output && typeof output === 'object' && 'data' in (output as object)) {
        const structured = output as StructuredTaskResult
        const ctxMeta = ctx.getMetadata()
        return {
          status: 'success',
          output: structured.data,
          summary: structured.summary,
          usage: {
            latency_ms: latencyMs,
            tokenUsage: structured.meta.tokenUsage ?? (ctxMeta.tokenUsage.totalTokens > 0 ? ctxMeta.tokenUsage : undefined),
            toolsInvoked: structured.meta.toolsInvoked ?? (ctxMeta.toolsInvoked.length > 0 ? ctxMeta.toolsInvoked : undefined),
            iterationsCount: structured.meta.iterationsCount ?? (ctxMeta.iterationsCount > 0 ? ctxMeta.iterationsCount : undefined),
          },
        }
      }

      if (output && typeof output === 'object' && (output as Record<string, unknown>).status) {
        return output as TaskResult
      }

      // 自动合并 TaskContext 追踪的元数据
      const ctxMeta = ctx.getMetadata()
      return {
        status: 'success',
        output: output ?? null,
        summary: `Task ${taskId} completed`,
        usage: {
          latency_ms: latencyMs,
          ...(ctxMeta.tokenUsage.totalTokens > 0 ? { tokenUsage: ctxMeta.tokenUsage } : {}),
          ...(ctxMeta.toolsInvoked.length > 0 ? { toolsInvoked: ctxMeta.toolsInvoked } : {}),
          ...(ctxMeta.iterationsCount > 0 ? { iterationsCount: ctxMeta.iterationsCount } : {}),
        },
      }
    } catch (err) {
      clearTimeout(timer)

      if (timedOut || abortController.signal.aborted) {
        return {
          status: 'failure',
          error: {
            code: timedOut ? ErrorCodes.ERR_TIMEOUT : ErrorCodes.ERR_TASK_CANCELLED,
            message: timedOut ? `Task timed out after ${timeoutSec}s` : 'Task was cancelled',
            retryable: timedOut
          }
        }
      }

      const message = err instanceof Error ? err.message : String(err)
      this.#logger.error(`Task ${taskId} failed: ${message}`)
      return {
        status: 'failure',
        error: {
          code: (err as { code?: ErrorCode }).code ?? ErrorCodes.ERR_UNKNOWN,
          message: message ?? 'Unknown error',
          retryable: (err as { retryable?: boolean }).retryable ?? true
        }
      }
    } finally {
      this.#activeControllers.delete(taskId)
      // 任务完成后从队列取下一个
      this.#drainQueue().catch(() => {})
    }
  }

  /** 处理任务取消 */
  handleTaskCancel(payload: { task_id?: string }): void {
    const taskId = payload?.task_id
    if (!taskId) return

    const controller = this.#activeControllers.get(taskId)
    if (controller) {
      this.#logger.info(`Cancelling task ${taskId}`)
      controller.abort()
    }
  }

  /** 获取当前状态统计 */
  getStats(): HeartbeatStats {
    const activeTasks = this.#activeControllers.size
    return {
      activeTasks,
      queueDepth: this.#queue.length,
      load: activeTasks / this.#maxConcurrent
    }
  }
}
