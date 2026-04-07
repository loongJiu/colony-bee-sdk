/**
 * 任务生命周期管理
 *
 * 管理任务执行的全生命周期，处理并发控制、超时和取消
 */

import { TaskContext } from './task-context.js'
import { ErrorCodes } from '../errors.js'

export class TaskManager {
  /** @type {Map<string, Function>} capability → handler */
  #handlers = new Map()
  /** @type {Map<string, AbortController>} taskId → AbortController */
  #activeControllers = new Map()
  /** @type {number} */
  #maxConcurrent
  /** @type {number} */
  #defaultTimeoutSec
  /** @type {number} */
  #queueMax
  /** @type {import('../logger.js').Logger} */
  #logger
  /** @type {import('./tool-registry.js').ToolRegistry} */
  #toolRegistry
  /** @type {import('../skill-registry.js').SkillRegistry} */
  #skillRegistry
  /** @type {Function|null} */
  #modelCaller
  /** @type {import('../logger.js').Logger} */
  #baseLogger

  /**
   * @param {{
   *   maxConcurrent?: number,
   *   defaultTimeoutSec?: number,
   *   queueMax?: number,
   *   toolRegistry: import('./tool-registry.js').ToolRegistry,
   *   skillRegistry: import('../skill-registry.js').SkillRegistry,
   *   modelCaller?: Function|null,
   *   logger: import('../logger.js').Logger
   * }} options
   */
  constructor(options) {
    this.#maxConcurrent = options.maxConcurrent ?? 1
    this.#defaultTimeoutSec = options.defaultTimeoutSec ?? 30
    this.#queueMax = options.queueMax ?? 100
    this.#toolRegistry = options.toolRegistry
    this.#skillRegistry = options.skillRegistry
    this.#modelCaller = options.modelCaller ?? null
    this.#baseLogger = options.logger
    this.#logger = options.logger.child({ component: 'task-manager' })
  }

  /**
   * 设置模型调用器
   *
   * @param {Function} fn
   */
  setModelCaller(fn) {
    this.#modelCaller = fn
  }

  /**
   * 注册 capability handler
   *
   * @param {string} capability
   * @param {Function} handler
   */
  registerHandler(capability, handler) {
    this.#handlers.set(capability, handler)
  }

  /**
   * 处理任务分配请求
   *
   * @param {Object} payload - Queen 发来的 task_assign payload
   * @returns {Promise<Object>} 标准化的任务结果
   */
  async handleTaskAssign(payload) {
    const task = payload.task ?? {}
    const context = payload.context ?? {}
    const taskId = task.task_id ?? 'unknown'
    const capability = task.name ?? task.description ?? ''
    const timeoutSec = task.constraints?.timeout ?? this.#defaultTimeoutSec

    // 查找 handler
    let handler = null
    for (const [cap, h] of this.#handlers) {
      if (capability.includes(cap) || task.description?.includes(cap)) {
        handler = h
        break
      }
    }

    // 如果没通过描述匹配到，使用第一个注册的 handler（简化匹配）
    if (!handler && this.#handlers.size > 0) {
      // 尝试用 payload 中的 capability 字段匹配
      // Queen 发送的 task.description 通常包含能力关键词
      handler = this.#handlers.values().next().value
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
      // 创建 TaskContext
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

      // 执行 handler
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

      // 标准化返回格式
      if (output && typeof output === 'object' && output.status) {
        return output
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

      this.#logger.error(`Task ${taskId} failed: ${err.message}`)
      return {
        status: 'failure',
        error: {
          code: err.code ?? ErrorCodes.ERR_UNKNOWN,
          message: err.message ?? 'Unknown error',
          retryable: err.retryable ?? true
        }
      }
    } finally {
      this.#activeControllers.delete(taskId)
    }
  }

  /**
   * 处理任务取消
   *
   * @param {{task_id?: string}} payload
   */
  handleTaskCancel(payload) {
    const taskId = payload?.task_id
    if (!taskId) return

    const controller = this.#activeControllers.get(taskId)
    if (controller) {
      this.#logger.info(`Cancelling task ${taskId}`)
      controller.abort()
    }
  }

  /**
   * 获取当前状态统计
   *
   * @returns {{activeTasks: number, queueDepth: number, load: number}}
   */
  getStats() {
    const activeTasks = this.#activeControllers.size
    return {
      activeTasks,
      queueDepth: 0,
      load: activeTasks / this.#maxConcurrent
    }
  }
}
