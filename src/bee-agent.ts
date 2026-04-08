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
import type { AgentStatus, TaskHandler, ModelCaller, SkillDefinition } from './types.js'

export interface BeeAgentEvents {
  joined: { agentId: string; sessionToken: string }
  disconnected: { reason: string }
  reconnected: { agentId: string }
}

export class BeeAgent extends EventEmitter {
  #spec: BeeSpec
  readonly #logger: Logger
  #queenClient: QueenClient | null = null
  #httpServer: BeeHttpServer | null = null
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

  constructor(spec: BeeSpec, logger?: Logger) {
    super()
    this.#spec = spec
    this.#logger = logger ?? new Logger()
    this.#toolRegistry = new ToolRegistry()
    this.#skillRegistry = new SkillRegistry()
    this.#taskManager = new TaskManager({
      maxConcurrent: spec.constraints.max_concurrent,
      defaultTimeoutSec: spec.constraints.timeout_default,
      queueMax: spec.constraints.queue_max,
      toolRegistry: this.#toolRegistry,
      skillRegistry: this.#skillRegistry,
      logger: this.#logger
    })
  }

  /** 从 bee.yaml 创建 BeeAgent */
  static async fromSpec(yamlPath: string, options: { logger?: Logger } = {}): Promise<BeeAgent> {
    const spec = await SpecLoader.load(yamlPath)
    return new BeeAgent(spec, options.logger)
  }

  /** 注册任务处理器 */
  onTask(capability: string, handler: TaskHandler): void {
    this.#taskManager.registerHandler(capability, handler)
  }

  /** 注册工具 */
  registerTool(id: string, handlerOrSchema: ((input: unknown) => unknown) | Record<string, unknown>): void {
    this.#toolRegistry.register(id, handlerOrSchema)
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
      // 1. 启动 HTTP 服务器
      this.#httpServer = new BeeHttpServer(this.#taskManager, this.#logger)
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
        this.#startReconnector()
      })

      this.#heartbeat.start(sessionToken, () => this.#taskManager.getStats())

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
        this.#startReconnector()
      })
      this.#heartbeat.start(sessionToken, () => this.#taskManager.getStats())

      this.emit('reconnected', { agentId })
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
    this.#sessionToken = null
  }
}
