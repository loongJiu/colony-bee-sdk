/**
 * 任务上下文 ctx
 *
 * 为每个任务提供执行上下文，包含所有 API
 */

import { SharedState } from '../shared-state.js'

export class TaskContext {
  /** @type {string} */
  taskId
  /** @type {string} */
  capability
  /** @type {*} */
  input
  /** @type {AbortSignal} */
  signal
  /** @type {import('../shared-state.js').SharedState} */
  state
  /** @type {import('../logger.js').Logger} */
  logger

  /** @type {import('../task/tool-registry.js').ToolRegistry} */
  #toolRegistry
  /** @type {import('../skill-registry.js').SkillRegistry} */
  #skillRegistry
  /** @type {Function|null} */
  #modelCaller
  /** @type {import('../logger.js').Logger} */
  #baseLogger

  /**
   * @param {{
   *   taskId: string,
   *   capability: string,
   *   input: any,
   *   signal: AbortSignal,
   *   conversationId?: string,
   *   sharedState?: Object,
   *   toolRegistry: import('../task/tool-registry.js').ToolRegistry,
   *   skillRegistry: import('../skill-registry.js').SkillRegistry,
   *   modelCaller?: Function|null,
   *   logger: import('../logger.js').Logger
   * }} options
   */
  constructor(options) {
    this.taskId = options.taskId
    this.capability = options.capability
    this.input = options.input
    this.signal = options.signal
    this.state = new SharedState(options.sharedState ?? {})
    this.#toolRegistry = options.toolRegistry
    this.#skillRegistry = options.skillRegistry
    this.#modelCaller = options.modelCaller ?? null
    this.#baseLogger = options.logger
    this.logger = options.logger.child({ taskId: options.taskId })
  }

  /**
   * 工具调用代理
   *
   * @type {Object}
   */
  get tools() {
    return new Proxy({}, {
      get: (_target, prop) => {
        if (typeof prop !== 'string') return undefined
        const tool = this.#toolRegistry.get(prop)
        if (!tool || !tool.handler) return undefined
        return (input) => tool.handler(input)
      }
    })
  }

  /**
   * 调用模型
   *
   * @param {string} prompt
   * @param {Object} [options]
   * @returns {Promise<any>}
   */
  async callModel(prompt, options) {
    if (!this.#modelCaller) {
      throw new Error('Model caller not configured. Use agent.setModelCaller(fn) to set it.')
    }
    return this.#modelCaller(prompt, options)
  }

  /**
   * 带工具的模型调用
   *
   * @param {string} prompt
   * @param {string[]} [tools]
   * @param {Object} [options]
   * @returns {Promise<any>}
   */
  async callModelWithTools(prompt, tools, options) {
    if (!this.#modelCaller) {
      throw new Error('Model caller not configured. Use agent.setModelCaller(fn) to set it.')
    }
    return this.#modelCaller(prompt, { ...options, tools })
  }

  /**
   * 上报进度
   *
   * @param {number} percent - 0-100
   * @param {string} [message]
   */
  progress(percent, message) {
    this.logger.info(`Progress: ${percent}%${message ? ` - ${message}` : ''}`)
  }

  /**
   * 激活技能
   *
   * @param {string} skillId
   * @param {*} [input]
   * @returns {Promise<any>}
   */
  async activateSkill(skillId, input) {
    return this.#skillRegistry.activate(skillId, input)
  }
}
