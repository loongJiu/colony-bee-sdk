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

/** 任务执行结果 */
export interface TaskResult {
  status: 'success' | 'failure'
  output?: unknown
  summary?: string
  usage?: { latency_ms: number }
  error?: {
    code: string
    message: string
    retryable: boolean
  }
}

/** 工具定义 */
export interface ToolDefinition {
  handler?: (input: unknown) => unknown | Promise<unknown>
  schema?: Record<string, unknown>
}

/** 技能定义 */
export interface SkillDefinition {
  handler?: (input: unknown) => unknown | Promise<unknown>
  prompt?: string
  description?: string
  [key: string]: unknown
}

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
