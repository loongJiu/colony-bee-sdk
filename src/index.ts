/**
 * colony-bee-sdk 入口
 *
 * @module colony-bee-sdk
 */

export { BeeAgent, type BeeAgentEvents } from './bee-agent.js'
export {
  BeeError,
  HandshakeError,
  ConnectionError,
  UnauthorizedError,
  TaskError,
  TimeoutError,
  ErrorCodes,
  type ErrorCode
} from './errors.js'
export { Logger } from './logger.js'
export { SpecLoader, BeeSpecSchema, type BeeSpec } from './spec-loader.js'
export { SharedState } from './shared-state.js'
export { TaskContext } from './task/task-context.js'
export { TaskManager } from './task/task-manager.js'
export { ToolRegistry } from './task/tool-registry.js'
export { SkillRegistry } from './skill-registry.js'
export type { EndpointAuthConfig } from './transport/http-server.js'
export type {
  AgentStatus,
  TaskHandler,
  ModelCaller,
  StreamingModelCaller,
  ModelResponse,
  StopReason,
  TaskResult,
  StructuredTaskResult,
  TokenUsage,
  ToolCall,
  ToolDefinition,
  ToolSchema,
  SkillDefinition,
  HeartbeatStats,
  HeartbeatOptions,
  ReconnectorOptions,
  JoinResponse,
  VerifyResponse,
  HeartbeatPayload,
  TaskAssignPayload,
  TaskCancelPayload,
  ServerAddress,
  ExternalLogger,
  QueueStrategy,
  TaskPriority
} from './types.js'
export type { FullToolDefinition } from './task/tool-registry.js'
