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

export class BeeAgent extends EventEmitter {
  /** @type {Object} spec */
  #spec
  /** @type {Logger} */
  #logger
  /** @type {QueenClient|null} */
  #queenClient = null
  /** @type {BeeHttpServer|null} */
  #httpServer = null
  /** @type {Handshake|null} */
  #handshake = null
  /** @type {HeartbeatManager|null} */
  #heartbeat = null
  /** @type {Reconnector|null} */
  #reconnector = null
  /** @type {TaskManager} */
  #taskManager
  /** @type {ToolRegistry} */
  #toolRegistry
  /** @type {SkillRegistry} */
  #skillRegistry
  /** @type {Function|null} */
  #modelCaller = null
  /** @type {string|null} */
  #sessionToken = null
  /** @type {string|null} */
  #agentId = null
  /** @type {string|null} */
  #colonyToken = null
  /** @type {'disconnected'|'joining'|'connected'|'leaving'} */
  #status = 'disconnected'

  /**
   * @param {Object} spec
   * @param {Logger} [logger]
   */
  constructor(spec, logger) {
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

  /**
   * 从 bee.yaml 创建 BeeAgent
   *
   * @param {string} yamlPath - YAML 文件路径
   * @param {{logger?: Logger}} [options]
   * @returns {Promise<BeeAgent>}
   */
  static async fromSpec(yamlPath, options = {}) {
    const spec = await SpecLoader.load(yamlPath)
    return new BeeAgent(spec, options.logger)
  }

  /**
   * 注册任务处理器
   *
   * @param {string} capability - 能力名称
   * @param {(ctx: import('./task/task-context.js').TaskContext) => Promise<any>} handler
   */
  onTask(capability, handler) {
    this.#taskManager.registerHandler(capability, handler)
  }

  /**
   * 注册工具
   *
   * @param {string} id
   * @param {Function|Object} handlerOrSchema
   */
  registerTool(id, handlerOrSchema) {
    this.#toolRegistry.register(id, handlerOrSchema)
  }

  /**
   * 定义技能
   *
   * @param {string} id
   * @param {Object} config
   */
  defineSkill(id, config) {
    this.#skillRegistry.define(id, config)
  }

  /**
   * 设置模型调用函数
   *
   * @param {Function} fn - async (prompt, options) => any
   */
  setModelCaller(fn) {
    this.#modelCaller = fn
    this.#taskManager.setModelCaller(fn)
  }

  /**
   * 加入 Colony
   *
   * 执行：启动 HTTP 服务器 → 四步握手 → 启动心跳
   *
   * @param {string} queenUrl - Queen 服务地址
   * @param {string} colonyToken - 共享密钥
   * @returns {Promise<{agentId: string, sessionToken: string}>}
   */
  async join(queenUrl, colonyToken) {
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

      // 覆盖 spec 中的 endpoint
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

      this.#heartbeat.on('disconnected', (data) => {
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

  /**
   * 优雅离开 Colony
   *
   * @returns {Promise<void>}
   */
  async leave() {
    if (this.#status === 'disconnected') return

    this.#status = 'leaving'

    try {
      if (this.#sessionToken && this.#queenClient) {
        await this.#queenClient.leave(this.#sessionToken)
      }
    } catch (err) {
      this.#logger.warn(`Leave request failed: ${err.message}`)
    }

    await this.#cleanup()
    this.#status = 'disconnected'
    this.emit('disconnected', { reason: 'leave' })
  }

  /**
   * 强制关闭所有资源
   */
  async close() {
    this.#reconnector?.stop()
    await this.#cleanup()
    this.#status = 'disconnected'
  }

  /**
   * 获取 Agent ID
   *
   * @returns {string|null}
   */
  get agentId() {
    return this.#agentId
  }

  /**
   * 获取当前状态
   *
   * @returns {string}
   */
  get status() {
    return this.#status
  }

  /**
   * 启动自动重连
   */
  #startReconnector() {
    if (this.#reconnector) return // 已经在重连中

    this.#reconnector = new Reconnector({}, this.#logger)

    this.#reconnector.on('reconnected', ({ agentId, sessionToken }) => {
      this.#agentId = agentId
      this.#sessionToken = sessionToken
      this.#status = 'connected'

      // 重启心跳
      if (this.#heartbeat) {
        this.#heartbeat.stop()
      }
      this.#heartbeat = new HeartbeatManager(
        this.#queenClient,
        { intervalMs: (this.#spec.heartbeat?.interval ?? 10) * 1000 },
        this.#logger
      )
      this.#heartbeat.on('disconnected', (data) => {
        this.#logger.warn(`Disconnected: ${data.reason}`)
        this.#status = 'disconnected'
        this.emit('disconnected', data)
        this.#startReconnector()
      })
      this.#heartbeat.start(sessionToken, () => this.#taskManager.getStats())

      this.emit('reconnected', { agentId })
      this.#reconnector = null
    })

    this.#reconnector.reconnect(this.#handshake, this.#spec, this.#colonyToken)
      .catch((err) => {
        this.#logger.error(`Reconnect failed: ${err.message}`)
        this.#reconnector = null
      })
  }

  /**
   * 清理所有资源
   */
  async #cleanup() {
    this.#heartbeat?.stop()
    await this.#httpServer?.stop()
    this.#sessionToken = null
    // 不清除 agentId，保留最后一次的身份信息
  }
}
