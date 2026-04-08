/**
 * 任务上下文 ctx
 *
 * 为每个任务提供执行上下文，包含所有 API
 */

import { SharedState } from '../shared-state.js'
import { Logger } from '../logger.js'
import { ToolRegistry } from './tool-registry.js'
import { SkillRegistry } from '../skill-registry.js'
import type { ModelCaller } from '../types.js'

export class TaskContext {
  readonly taskId: string
  readonly capability: string
  readonly input: unknown
  readonly signal: AbortSignal
  readonly state: SharedState
  readonly logger: Logger

  readonly #toolRegistry: ToolRegistry
  readonly #skillRegistry: SkillRegistry
  readonly #modelCaller: ModelCaller | null

  constructor(options: {
    taskId: string
    capability: string
    input: unknown
    signal: AbortSignal
    conversationId?: string
    sharedState?: Record<string, unknown>
    toolRegistry: ToolRegistry
    skillRegistry: SkillRegistry
    modelCaller?: ModelCaller | null
    logger: Logger
  }) {
    this.taskId = options.taskId
    this.capability = options.capability
    this.input = options.input
    this.signal = options.signal
    this.state = new SharedState(options.sharedState ?? {})
    this.#toolRegistry = options.toolRegistry
    this.#skillRegistry = options.skillRegistry
    this.#modelCaller = options.modelCaller ?? null
    this.logger = options.logger.child({ taskId: options.taskId })
  }

  /** 工具调用代理 */
  get tools(): Record<string, (input: unknown) => unknown> {
    return new Proxy({} as Record<string, (input: unknown) => unknown>, {
      get: (_target: Record<string, (input: unknown) => unknown>, prop: string | symbol): ((input: unknown) => unknown) | undefined => {
        if (typeof prop !== 'string') return undefined
        const tool = this.#toolRegistry.get(prop)
        if (!tool?.handler) return undefined
        return (input: unknown) => tool.handler!(input)
      }
    })
  }

  /** 调用模型 */
  async callModel(prompt: string, options?: Record<string, unknown>): Promise<unknown> {
    if (!this.#modelCaller) {
      throw new Error('Model caller not configured. Use agent.setModelCaller(fn) to set it.')
    }
    return this.#modelCaller(prompt, options)
  }

  /** 带工具的模型调用 */
  async callModelWithTools(prompt: string, tools?: string[], options?: Record<string, unknown>): Promise<unknown> {
    if (!this.#modelCaller) {
      throw new Error('Model caller not configured. Use agent.setModelCaller(fn) to set it.')
    }
    return this.#modelCaller(prompt, { ...options, tools })
  }

  /** 上报进度 */
  progress(percent: number, message?: string): void {
    this.logger.info(`Progress: ${percent}%${message ? ` - ${message}` : ''}`)
  }

  /** 激活技能 */
  async activateSkill(skillId: string, input?: unknown): Promise<unknown> {
    return this.#skillRegistry.activate(skillId, input)
  }
}
