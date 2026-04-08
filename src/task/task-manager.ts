/**
 * 任务生命周期管理
 *
 * 管理任务执行的全生命周期，处理并发控制、超时和取消
 */

import { TaskContext } from './task-context.js'
import { ErrorCodes, type ErrorCode } from '../errors.js'
import { Logger } from '../logger.js'
import { ToolRegistry } from './tool-registry.js'
import { SkillRegistry } from '../skill-registry.js'
import type { TaskHandler, ModelCaller, TaskAssignPayload, HeartbeatStats } from '../types.js'

interface TaskResult {
  status: 'success' | 'failure'
  output?: unknown
  summary?: string
  usage?: { latency_ms: number }
  error?: {
    code: ErrorCode
    message: string
    retryable: boolean
  }
}

export class TaskManager {
  readonly #handlers: Map<string, TaskHandler> = new Map()
  readonly #activeControllers: Map<string, AbortController> = new Map()
  readonly #maxConcurrent: number
  readonly #defaultTimeoutSec: number
  readonly #queueMax: number
  readonly #logger: Logger
  readonly #toolRegistry: ToolRegistry
  readonly #skillRegistry: SkillRegistry
  #modelCaller: ModelCaller | null
  readonly #baseLogger: Logger

  constructor(options: {
    maxConcurrent?: number
    defaultTimeoutSec?: number
    queueMax?: number
    toolRegistry: ToolRegistry
    skillRegistry: SkillRegistry
    modelCaller?: ModelCaller | null
    logger: Logger
  }) {
    this.#maxConcurrent = options.maxConcurrent ?? 1
    this.#defaultTimeoutSec = options.defaultTimeoutSec ?? 30
    this.#queueMax = options.queueMax ?? 100
    this.#toolRegistry = options.toolRegistry
    this.#skillRegistry = options.skillRegistry
    this.#modelCaller = options.modelCaller ?? null
    this.#baseLogger = options.logger
    this.#logger = options.logger.child({ component: 'task-manager' })
  }

  /** 设置模型调用器 */
  setModelCaller(fn: ModelCaller): void {
    this.#modelCaller = fn
  }

  /** 注册 capability handler */
  registerHandler(capability: string, handler: TaskHandler): void {
    this.#handlers.set(capability, handler)
  }

  /** 处理任务分配请求 */
  async handleTaskAssign(payload: TaskAssignPayload): Promise<TaskResult> {
    const task = payload.task ?? {}
    const context = payload.context ?? {}
    const taskId = task.task_id ?? 'unknown'
    const capability = task.name ?? task.description ?? ''
    const timeoutSec = task.constraints?.timeout ?? this.#defaultTimeoutSec

    // 查找 handler
    let handler: TaskHandler | null = null
    for (const [cap, h] of this.#handlers) {
      if (capability.includes(cap) || task.description?.includes(cap)) {
        handler = h
        break
      }
    }

    if (!handler && this.#handlers.size > 0) {
      handler = this.#handlers.values().next().value ?? null
    }

    if (!handler) {
      return {
        status: 'failure',
        error: {
          code: ErrorCodes.ERR_NO_HANDLER,
          message: `No handler registered for capability: ${capability}`,
          retryable: false
        }
      }
    }

    // 并发检查
    if (this.#activeControllers.size >= this.#maxConcurrent) {
      return {
        status: 'failure',
        error: {
          code: ErrorCodes.ERR_OVERLOADED,
          message: `Agent overloaded: ${this.#activeControllers.size}/${this.#maxConcurrent} tasks active`,
          retryable: true
        }
      }
    }

    // 创建 AbortController 和超时
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
        logger: this.#baseLogger
      })

      this.#logger.info(`Executing task ${taskId} (timeout: ${timeoutSec}s)`)

      const output = await handler(ctx)

      clearTimeout(timer)

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

      if (output && typeof output === 'object' && (output as Record<string, unknown>).status) {
        return output as TaskResult
      }

      return {
        status: 'success',
        output: output ?? null,
        summary: `Task ${taskId} completed`,
        usage: { latency_ms: latencyMs }
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
      queueDepth: 0,
      load: activeTasks / this.#maxConcurrent
    }
  }
}
