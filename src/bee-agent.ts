/**
 * BeeAgent 核心类
 *
 * SDK 的主类，协调所有子系统：
 * - spec 加载
 * - HTTP 服务器（接收 Queen 任务分发）
 * - Queen 客户端（握手、心跳、离开）
 * - 任务管理
 */

import { EventEmitter } from 'node:events'
import { SpecLoader } from './spec-loader.js'
import { QueenClient } from './transport/queen-client.js'
import { BeeHttpServer } from './transport/http-server.js'
import { Handshake } from './protocol/handshake.js'
import { HeartbeatManager } from './protocol/heartbeat.js'
import { Reconnector } from './protocol/reconnector.js'
import { TaskManager } from './task/task-manager.js'
import { ToolRegistry } from './task/tool-registry.js'
import { SkillRegistry } from './skill-registry.js'
import { Logger } from './logger.js'
import { BeeError } from './errors.js'
import type { BeeSpec } from './spec-loader.js'
import type { AgentStatus, TaskHandler, ModelCaller, StreamingModelCaller, SkillDefinition, ToolSchema, ExternalLogger } from './types.js'
import type { FullToolDefinition } from './task/tool-registry.js'

export interface BeeAgentEvents {
  joined: { agentId: string; sessionToken: string }
  disconnected: { reason: string }
  reconnected: { agentId: string }
}

export class BeeAgent extends EventEmitter {
  #spec: BeeSpec
  readonly #logger: Logger
  #devMode: boolean
  #queenClient: QueenClient | null = null
  #httpServer: BeeHttpServer | null = null
  #healthServer: BeeHttpServer | null = null
  #handshake: Handshake | null = null
  #heartbeat: HeartbeatManager | null = null
  #reconnector: Reconnector | null = null
  readonly #taskManager: TaskManager
  readonly #toolRegistry: ToolRegistry
  readonly #skillRegistry: SkillRegistry
  #modelCaller: ModelCaller | null = null
  #sessionToken: string | null = null
  #agentId: string | null = null
  #colonyToken: string | null = null
  #status: AgentStatus = 'disconnected'
  #startedAt = Date.now()
  #reconnectCount = 0

  constructor(spec: BeeSpec, logger?: Logger | ExternalLogger, devMode?: boolean) {
    super()
    this.#spec = spec
    this.#devMode = devMode ?? false
    this.#logger = this.#devMode
      ? (logger instanceof Logger ? logger : this.#adaptLogger(logger) || new Logger({ level: 'debug' }))
      : (logger instanceof Logger ? logger : this.#adaptLogger(logger))
    if (this.#devMode) {
      this.#logger.info('[devMode] Development mode enabled - verbose logging, no auto-reconnect')
    }
    this.#toolRegistry = new ToolRegistry()
    this.#skillRegistry = new SkillRegistry()
    this.#taskManager = new TaskManager({
      maxConcurrent: spec.constraints.max_concurrent,
      defaultTimeoutSec: spec.constraints.timeout_default,
      queueMax: spec.constraints.queue_max,
      queueStrategy: spec.constraints.queue_strategy,
      devMode: this.#devMode,
      toolRegistry: this.#toolRegistry,
      skillRegistry: this.#skillRegistry,
      logger: this.#logger
    })
  }

  /** 从 bee.yaml 创建 BeeAgent */
  static async fromSpec(yamlPath: string, options: { logger?: Logger | ExternalLogger; devMode?: boolean } = {}): Promise<BeeAgent> {
    const spec = await SpecLoader.load(yamlPath)
    return new BeeAgent(spec, options.logger, options.devMode)
  }

  /** 从环境变量创建 BeeAgent（适用于容器化部署） */
  static fromEnv(): BeeAgent {
    const role = (process.env.BEE_ROLE ?? 'worker') as 'worker' | 'scout'
    const name = process.env.BEE_NAME ?? 'env-agent'
    const capabilities = (process.env.BEE_CAPABILITIES ?? '').split(',').map(s => s.trim()).filter(Boolean)
    const maxConcurrent = parseInt(process.env.BEE_MAX_CONCURRENT ?? '1', 10)
    const timeoutDefault = parseInt(process.env.BEE_TIMEOUT ?? '30', 10)
    const queueMax = parseInt(process.env.BEE_QUEUE_MAX ?? '100', 10)

    if (capabilities.length === 0) {
      throw new BeeError('BEE_CAPABILITIES environment variable is required (comma-separated)')
    }

    const spec: BeeSpec = {
      identity: { role, name, description: '', tags: [] },
      runtime: { protocol: 'http', health_check: { enabled: false, port: 9010, path: '/health' } },
      capabilities,
      model: undefined as any,
      tools: [],
      skills: [],
      constraints: {
        max_concurrent: isNaN(maxConcurrent) ? 1 : maxConcurrent,
        timeout_default: isNaN(timeoutDefault) ? 30 : timeoutDefault,
        queue_max: isNaN(queueMax) ? 100 : queueMax,
        queue_strategy: 'fifo',
        retry_max: 3,
      },
      security: {},
      heartbeat: { interval: 10 },
    }

    return new BeeAgent(spec)
  }

  /** 适配外部日志器为内部 Logger */
  #adaptLogger(external?: ExternalLogger): Logger {
    if (!external) return new Logger()
    // 用外部日志器作为输出
    return new Logger({
      level: 'debug',
      output: {
        log: (msg: string) => external.info(msg),
        warn: (msg: string) => external.warn(msg),
        error: (msg: string) => external.error(msg),
      }
    })
  }

  /** 注册任务处理器（支持泛型） */
  onTask<TInput = unknown, TOutput = unknown>(
    capability: string,
    handler: (ctx: import('./task/task-context.js').TaskContext<TInput>) => Promise<TOutput | import('./types.js').StructuredTaskResult<TOutput>>,
  ): void {
    this.#taskManager.registerHandler(capability, handler as TaskHandler)
  }

  /** 注册工具（支持函数简写、纯 schema 对象、和带 schema 的完整定义） */
  registerTool(id: string, handlerOrDef: ((input: unknown) => unknown) | FullToolDefinition | Record<string, unknown>): void {
    this.#toolRegistry.register(id, handlerOrDef)
  }

  /** 获取所有已注册工具的 JSON Schema */
  getToolSchemas(): ToolSchema[] {
    return this.#toolRegistry.getToolSchemas()
  }

  /** 定义技能 */
  defineSkill(id: string, config: SkillDefinition): void {
    this.#skillRegistry.define(id, config)
  }

  /** 设置模型调用函数 */
  setModelCaller(fn: ModelCaller): void {
    this.#modelCaller = fn
    this.#taskManager.setModelCaller(fn)
  }

  /** 设置流式模型调用函数 */
  setStreamingModelCaller(fn: StreamingModelCaller): void {
    this.#taskManager.setStreamingModelCaller(fn)
  }

  /**
   * 加入 Colony
   *
   * 执行：启动 HTTP 服务器 → 四步握手 → 启动心跳
   */
  async join(queenUrl: string, colonyToken: string): Promise<{ agentId: string; sessionToken: string }> {
    if (this.#status !== 'disconnected') {
      throw new BeeError(`Cannot join in state: ${this.#status}`)
    }

    this.#status = 'joining'
    this.#colonyToken = colonyToken

    try {
      // 1. 启动 HTTP 服务器（传递端点认证配置）
      this.#httpServer = new BeeHttpServer(this.#taskManager, this.#logger, this.#spec.security?.endpoint_auth)
      const endpoint = this.#spec.runtime.endpoint
      let port = 0
      if (endpoint) {
        try {
          const url = new URL(endpoint)
          port = parseInt(url.port, 10) || 0
        } catch { /* ignore parse error, use auto-assign */ }
      }

      const { port: actualPort } = await this.#httpServer.start(port)
      const actualEndpoint = `http://127.0.0.1:${actualPort}`

      this.#spec = { ...this.#spec, runtime: { ...this.#spec.runtime, endpoint: actualEndpoint } }

      // 2. 创建 Queen 客户端和握手
      this.#queenClient = new QueenClient(queenUrl, this.#logger)
      this.#handshake = new Handshake(this.#queenClient, this.#logger)

      const { agentId, sessionToken } = await this.#handshake.execute(this.#spec, colonyToken)
      this.#agentId = agentId
      this.#sessionToken = sessionToken

      // 3. 启动心跳
      this.#heartbeat = new HeartbeatManager(
        this.#queenClient,
        { intervalMs: (this.#spec.heartbeat?.interval ?? 10) * 1000 },
        this.#logger
      )

      this.#heartbeat.on('disconnected', (data: { reason: string }) => {
        this.#logger.warn(`Disconnected: ${data.reason}`)
        this.#status = 'disconnected'
        this.emit('disconnected', data)
        if (!this.#devMode) {
          this.#startReconnector()
        } else {
          this.#logger.info('[devMode] Skipping auto-reconnect')
        }
      })

      this.#heartbeat.start(sessionToken, () => this.#taskManager.getStats())

      // 4. 启动健康检查服务器（可选）
      const hc = this.#spec.runtime.health_check
      if (hc?.enabled) {
        this.#healthServer = new BeeHttpServer(this.#taskManager, this.#logger)
        await this.#healthServer.start(hc.port)
        this.#logger.info(`Health check server listening on port ${hc.port}`)
      }

      this.#status = 'connected'
      this.emit('joined', { agentId, sessionToken })

      return { agentId, sessionToken }
    } catch (err) {
      this.#status = 'disconnected'
      await this.#cleanup()
      throw err
    }
  }

  /** 优雅离开 Colony */
  async leave(): Promise<void> {
    if (this.#status === 'disconnected') return

    this.#status = 'leaving'

    try {
      if (this.#sessionToken && this.#queenClient) {
        await this.#queenClient.leave(this.#sessionToken)
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      this.#logger.warn(`Leave request failed: ${message}`)
    }

    await this.#cleanup()
    this.#status = 'disconnected'
    this.emit('disconnected', { reason: 'leave' })
  }

  /** 强制关闭所有资源 */
  async close(): Promise<void> {
    this.#reconnector?.stop()
    await this.#cleanup()
    this.#status = 'disconnected'
  }

  /** 获取 Agent ID */
  get agentId(): string | null {
    return this.#agentId
  }

  /** 获取当前状态 */
  get status(): AgentStatus {
    return this.#status
  }

  #startReconnector(): void {
    if (this.#reconnector) return

    this.#reconnector = new Reconnector({}, this.#logger)

    this.#reconnector.on('reconnected', ({ agentId, sessionToken }: { agentId: string; sessionToken: string }) => {
      this.#agentId = agentId
      this.#sessionToken = sessionToken
      this.#status = 'connected'

      if (this.#heartbeat) {
        this.#heartbeat.stop()
      }
      this.#heartbeat = new HeartbeatManager(
        this.#queenClient!,
        { intervalMs: (this.#spec.heartbeat?.interval ?? 10) * 1000 },
        this.#logger
      )
      this.#heartbeat.on('disconnected', (data: { reason: string }) => {
        this.#logger.warn(`Disconnected: ${data.reason}`)
        this.#status = 'disconnected'
        this.emit('disconnected', data)
        if (!this.#devMode) {
          this.#startReconnector()
        }
      })
      this.#heartbeat.start(sessionToken, () => this.#taskManager.getStats())

      this.emit('reconnected', { agentId })
      this.#reconnectCount++
      this.#reconnector = null
    })

    this.#reconnector.reconnect(this.#handshake!, this.#spec, this.#colonyToken!)
      .catch((err: unknown) => {
        const message = err instanceof Error ? err.message : String(err)
        this.#logger.error(`Reconnect failed: ${message}`)
        this.#reconnector = null
      })
  }

  async #cleanup(): Promise<void> {
    this.#heartbeat?.stop()
    await this.#httpServer?.stop()
    await this.#healthServer?.stop()
    this.#sessionToken = null
  }
}
