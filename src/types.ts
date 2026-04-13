/**
 * 共享类型定义
 *
 * 集中定义跨模块使用的接口和类型别名
 */

import type { TaskContext } from './task/task-context.js'

/** Agent 连接状态 */
export type AgentStatus = 'disconnected' | 'joining' | 'connected' | 'leaving'

/** 任务处理器签名 */
export type TaskHandler = (ctx: TaskContext) => Promise<unknown>

/** 模型调用函数签名 */
export type ModelCaller = (prompt: string, options?: Record<string, unknown>) => Promise<unknown>

/** 流式模型调用函数签名 */
export type StreamingModelCaller = (
  prompt: string,
  options: Record<string, unknown> & { stream: true },
  onChunk: (chunk: string) => void,
) => Promise<ModelResponse>

/** 模型停止原因 */
export type StopReason = 'end_turn' | 'tool_use' | 'max_tokens' | 'stop_sequence'

/** 工具调用 */
export interface ToolCall {
  /** 工具调用 ID（用于匹配 tool result） */
  id: string
  /** 工具名称 */
  name: string
  /** 工具输入（已解析） */
  input: unknown
  /** 工具执行结果 */
  result?: unknown
  /** 工具执行错误 */
  error?: string
}

/** 模型调用响应（结构化） */
export interface ModelResponse {
  /** 文本响应 */
  content: string
  /** 工具调用列表（如有） */
  toolCalls?: ToolCall[]
  /** token 消耗 */
  usage: {
    inputTokens: number
    outputTokens: number
    totalTokens: number
  }
  /** 停止原因 */
  stopReason: StopReason
  /** 模型返回的原始数据（用于调试） */
  raw?: unknown
}

/** 任务执行结果 */
export interface TaskResult {
  status: 'success' | 'failure'
  output?: unknown
  summary?: string
  usage?: {
    latency_ms: number
    tokenUsage?: TokenUsage
    toolsInvoked?: string[]
    iterationsCount?: number
  }
  error?: {
    code: string
    message: string
    retryable: boolean
  }
}

/** Token 消耗统计 */
export interface TokenUsage {
  inputTokens: number
  outputTokens: number
  totalTokens: number
}

/** 结构化任务结果（类型化输出 + 自动收集的元数据） */
export interface StructuredTaskResult<T = unknown> {
  /** 任务输出数据 */
  data: T
  /** 任务元数据（自动收集） */
  meta: {
    durationMs: number
    tokenUsage?: TokenUsage
    toolsInvoked?: string[]
    iterationsCount?: number
  }
  /** 可选的人类可读摘要 */
  summary?: string
}

/** 工具 JSON Schema（供 LLM 调用，兼容 OpenAI / Anthropic 格式） */
export interface ToolSchema {
  name: string
  description?: string
  parameters: {
    type: 'object'
    properties: Record<string, unknown>
    required?: string[]
  }
}

/** 工具定义 */
export interface ToolDefinition {
  handler?: (input: unknown) => unknown | Promise<unknown>
  schema?: Record<string, unknown>
  description?: string
  inputSchema?: import('zod').ZodType
  outputSchema?: import('zod').ZodType
}

/** 技能定义 */
export interface SkillDefinition {
  handler?: (input: unknown) => unknown | Promise<unknown>
  prompt?: string
  description?: string
  [key: string]: unknown
}

/** 可替换日志接口（兼容 pino / winston / console 等） */
export interface ExternalLogger {
  debug(msg: string, meta?: object): void
  info(msg: string, meta?: object): void
  warn(msg: string, meta?: object): void
  error(msg: string, meta?: object): void
}

/** 队列调度策略 */
export type QueueStrategy = 'fifo' | 'priority'

/** 任务优先级 */
export type TaskPriority = 'high' | 'normal' | 'low'

/** 心跳上报统计 */
export interface HeartbeatStats {
  activeTasks: number
  queueDepth: number
  load: number
}

/** 心跳配置 */
export interface HeartbeatOptions {
  intervalMs?: number
}

/** 重连配置 */
export interface ReconnectorOptions {
  baseDelayMs?: number
  maxDelayMs?: number
}

/** Queen join 响应 */
export interface JoinResponse {
  nonce: string
  expiresAt: string
}

/** Queen verify 响应 */
export interface VerifyResponse {
  agent_id: string
  session_token: string
  queen_id: string
  colony_version: string
  joined_at: string
}

/** Queen 心跳请求载荷 */
export interface HeartbeatPayload {
  status?: string
  load?: number
  active_tasks?: number
  queue_depth?: number
}

/** Queen 任务分配载荷 */
export interface TaskAssignPayload {
  task?: {
    task_id?: string
    name?: string
    description?: string
    input?: unknown
    constraints?: { timeout?: number }
  }
  context?: {
    conversation_id?: string
    shared_state?: Record<string, unknown>
  }
}

/** Queen 任务取消载荷 */
export interface TaskCancelPayload {
  task_id?: string
}

/** HTTP 服务器地址信息 */
export interface ServerAddress {
  port: number
  address: string
}

/** TaskManager 构造函数参数 */
export interface TaskManagerOptions {
  maxConcurrent?: number
  defaultTimeoutSec?: number
  queueMax?: number
  toolRegistry: import('./task/tool-registry.js').ToolRegistry
  skillRegistry: import('./skill-registry.js').SkillRegistry
  modelCaller?: ModelCaller | null
  logger: import('./logger.js').Logger
}
