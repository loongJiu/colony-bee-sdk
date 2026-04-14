/**
 * 任务上下文 ctx
 *
 * 为每个任务提供执行上下文，包含所有 API
 */

import { SharedState } from '../shared-state.js'
import { Logger } from '../logger.js'
import { ToolRegistry } from './tool-registry.js'
import { SkillRegistry } from '../skill-registry.js'
import type { ModelCaller, ModelResponse, StreamingModelCaller, TokenUsage, ToolCall, ToolSchema } from '../types.js'

export class TaskContext<TInput = unknown> {
  readonly taskId: string
  readonly capability: string
  readonly input: TInput
  readonly signal: AbortSignal
  readonly state: SharedState
  readonly logger: Logger

  readonly #toolRegistry: ToolRegistry
  readonly #skillRegistry: SkillRegistry
  readonly #modelCaller: ModelCaller | null
  readonly #streamingModelCaller: StreamingModelCaller | null

  /** 元数据追踪 */
  #toolsInvoked: string[] = []
  #iterationsCount = 0
  #tokenUsage: TokenUsage = { inputTokens: 0, outputTokens: 0, totalTokens: 0 }

  /** 缓存的工具调用代理（构造时创建一次） */
  readonly #toolsProxy: Record<string, (input: unknown) => unknown>

  constructor(options: {
    taskId: string
    capability: string
    input: TInput
    signal: AbortSignal
    requestId?: string
    sessionId?: string
    agentId?: string
    conversationId?: string
    sharedState?: Record<string, unknown>
    toolRegistry: ToolRegistry
    skillRegistry: SkillRegistry
    modelCaller?: ModelCaller | null
    streamingModelCaller?: StreamingModelCaller | null
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
    this.#streamingModelCaller = options.streamingModelCaller ?? null
    this.logger = options.logger.child({
      taskId: options.taskId,
      requestId: options.requestId ?? 'unknown',
      sessionId: options.sessionId ?? 'unknown',
      agentId: options.agentId ?? 'unknown',
    })
    this.#toolsProxy = new Proxy({} as Record<string, (input: unknown) => unknown>, {
      get: (_target: Record<string, (input: unknown) => unknown>, prop: string | symbol): ((input: unknown) => unknown) | undefined => {
        if (typeof prop !== 'string') return undefined
        const tool = this.#toolRegistry.get(prop)
        if (!tool?.handler) return undefined
        return (input: unknown) => {
          this.#toolsInvoked.push(prop)
          return tool.handler!(input)
        }
      }
    })
  }

  /** 工具调用代理（自动追踪调用的工具） */
  get tools(): Record<string, (input: unknown) => unknown> {
    return this.#toolsProxy
  }

  /** 调用模型 */
  async callModel(prompt: string, options?: Record<string, unknown>): Promise<unknown> {
    if (!this.#modelCaller) {
      throw new Error('Model caller not configured. Use agent.setModelCaller(fn) to set it.')
    }
    return this.#modelCaller(prompt, options)
  }

  /**
   * 流式模型调用
   *
   * 通过 onChunk 回调实时输出内容，最终返回完整的 ModelResponse。
   * 若未配置 streamingModelCaller，则回退到普通 callModel 并一次性输出。
   */
  async streamModel(prompt: string, onChunk: (chunk: string) => void, options?: Record<string, unknown>): Promise<ModelResponse> {
    if (this.#streamingModelCaller) {
      return this.#streamingModelCaller(prompt, { ...options, stream: true }, onChunk)
    }

    // 回退：使用普通 modelCaller，将完整响应作为单次 chunk 输出
    if (!this.#modelCaller) {
      throw new Error('Model caller not configured. Use agent.setModelCaller(fn) to set it.')
    }

    const raw = await this.#modelCaller(prompt, options)
    const response = this.#parseModelResponse(raw)
    if (response.content) {
      onChunk(response.content)
    }
    return response
  }

  /**
   * 带工具的模型调用
   *
   * 单轮工具调用解析：
   * 1. 将 tool ID 列表解析为 JSON Schema
   * 2. 调用 modelCaller 并透传 tools schema
   * 3. 解析响应，如包含 toolCalls 则执行对应工具
   * 4. 返回 ModelResponse
   *
   * 注意：本方法仅处理单轮，agentic loop 由 harness 层负责
   */
  async callModelWithTools(prompt: string, tools?: string[], options?: Record<string, unknown>): Promise<ModelResponse> {
    if (!this.#modelCaller) {
      throw new Error('Model caller not configured. Use agent.setModelCaller(fn) to set it.')
    }

    // 1. 解析 tool schemas
    const toolSchemas = this.#resolveToolSchemas(tools)

    // 2. 调用 modelCaller，透传 tools schema
    const rawResponse = await this.#modelCaller(prompt, { ...options, tools: toolSchemas })

    // 3. 解析为 ModelResponse
    const response = this.#parseModelResponse(rawResponse)

    // 追踪元数据
    this.#iterationsCount++
    this.#accumulateTokenUsage(response.usage)

    // 4. 如果模型请求调用工具，执行工具并附加结果
    if (response.stopReason === 'tool_use' && response.toolCalls?.length) {
      await this.#executeToolCalls(response.toolCalls)
    }

    return response
  }

  /** 将 tool ID 列表解析为 JSON Schema */
  #resolveToolSchemas(toolIds?: string[]): ToolSchema[] {
    if (!toolIds || toolIds.length === 0) {
      return this.#toolRegistry.getToolSchemas()
    }
    const allSchemas = this.#toolRegistry.getToolSchemas()
    const schemaMap = new Map(allSchemas.map(s => [s.name, s]))
    return toolIds
      .map(id => schemaMap.get(id))
      .filter((s): s is ToolSchema => s !== undefined)
  }

  /** 将 modelCaller 返回值解析为 ModelResponse */
  #parseModelResponse(raw: unknown): ModelResponse {
    if (typeof raw === 'object' && raw !== null) {
      const obj = raw as Record<string, unknown>
      return {
        content: typeof obj.content === 'string' ? obj.content : '',
        toolCalls: Array.isArray(obj.toolCalls) ? obj.toolCalls as ToolCall[] : undefined,
        usage: obj.usage && typeof obj.usage === 'object'
          ? obj.usage as ModelResponse['usage']
          : { inputTokens: 0, outputTokens: 0, totalTokens: 0 },
        stopReason: (['end_turn', 'tool_use', 'max_tokens', 'stop_sequence'].includes(obj.stopReason as string)
          ? obj.stopReason
          : 'end_turn') as ModelResponse['stopReason'],
        raw: obj.raw,
      }
    }
    // modelCaller 返回字符串等原始值
    return {
      content: String(raw),
      usage: { inputTokens: 0, outputTokens: 0, totalTokens: 0 },
      stopReason: 'end_turn',
    }
  }

  /** 执行工具调用并附加结果 */
  async #executeToolCalls(toolCalls: ToolCall[]): Promise<void> {
    const promises = toolCalls.map(async (call) => {
      this.#toolsInvoked.push(call.name)
      const tool = this.#toolRegistry.get(call.name)
      if (!tool?.handler) {
        call.error = `Tool not found: ${call.name}`
        return
      }
      try {
        call.result = await tool.handler(call.input)
      } catch (err) {
        call.error = err instanceof Error ? err.message : String(err)
      }
    })
    await Promise.all(promises)
  }

  /** 上报进度 */
  progress(percent: number, message?: string): void {
    this.logger.info(`Progress: ${percent}%${message ? ` - ${message}` : ''}`)
  }

  /** 激活技能 */
  async activateSkill(skillId: string, input?: unknown): Promise<unknown> {
    return this.#skillRegistry.activate(skillId, input)
  }

  /** 获取当前任务元数据（由 TaskManager 在任务结束时读取） */
  getMetadata(): { toolsInvoked: string[]; iterationsCount: number; tokenUsage: TokenUsage } {
    return {
      toolsInvoked: [...this.#toolsInvoked],
      iterationsCount: this.#iterationsCount,
      tokenUsage: { ...this.#tokenUsage },
    }
  }

  /** 累加 token 使用量 */
  #accumulateTokenUsage(usage: { inputTokens: number; outputTokens: number; totalTokens: number }): void {
    this.#tokenUsage.inputTokens += usage.inputTokens
    this.#tokenUsage.outputTokens += usage.outputTokens
    this.#tokenUsage.totalTokens += usage.totalTokens
  }
}
