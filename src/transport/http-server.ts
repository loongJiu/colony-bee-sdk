/**
 * 内嵌 HTTP 服务器
 *
 * 使用 node:http 创建轻量服务器，处理 Queen 发来的请求：
 *   POST /bee/task   - 接收任务分配
 *   POST /bee/cancel - 取消任务
 *   GET  /bee/health - 健康检查
 */

import { createServer, type IncomingMessage, type ServerResponse, type Server } from 'node:http'
import { createHmac, timingSafeEqual } from 'node:crypto'
import { TaskManager } from '../task/task-manager.js'
import { Logger } from '../logger.js'
import type { ServerAddress, TaskAssignPayload, TaskCancelPayload } from '../types.js'

/** 端点认证配置 */
export interface EndpointAuthConfig {
  type: 'bearer' | 'hmac'
  secret: string
}

export class BeeHttpServer {
  readonly #taskManager: TaskManager
  readonly #logger: Logger
  readonly #authConfig: EndpointAuthConfig | null
  #server: Server | null = null

  constructor(taskManager: TaskManager, logger: Logger, authConfig?: EndpointAuthConfig) {
    this.#taskManager = taskManager
    this.#authConfig = authConfig ?? null
    this.#logger = logger.child({ component: 'http-server' })
  }

  /** 启动 HTTP 服务器 */
  start(port = 0, host = '0.0.0.0'): Promise<{ port: number }> {
    return new Promise((resolve, reject) => {
      this.#server = createServer((req, res) => {
        this.#handleRequest(req, res)
      })

      this.#server.on('error', reject)

      this.#server.listen(port, host, () => {
        const addr = this.#server!.address() as ServerAddress
        this.#logger.info(`HTTP server listening on ${addr.address}:${addr.port}`)
        resolve({ port: addr.port })
      })
    })
  }

  /** 停止 HTTP 服务器 */
  stop(): Promise<void> {
    return new Promise((resolve) => {
      if (!this.#server) return resolve()
      this.#server.close(() => {
        this.#logger.info('HTTP server stopped')
        this.#server = null
        resolve()
      })
    })
  }

  /** 获取服务器地址信息 */
  get address(): ServerAddress | null {
    if (!this.#server) return null
    return this.#server.address() as ServerAddress
  }

  #handleRequest(req: IncomingMessage, res: ServerResponse): void {
    res.setHeader('Access-Control-Allow-Origin', '*')
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS')
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization')

    if (req.method === 'OPTIONS') {
      res.writeHead(204)
      res.end()
      return
    }

    // 端点认证检查（仅对 POST 端点生效）
    if (req.method === 'POST' && this.#authConfig && !this.#authenticate(req)) {
      this.#logger.warn(`Unauthorized request to ${req.url}`)
      res.writeHead(401, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify({ error: 'Unauthorized' }))
      return
    }

    const url = new URL(req.url!, `http://${req.headers.host}`)

    if (req.method === 'POST' && url.pathname === '/bee/task') {
      this.#handleTask(req, res)
      return
    }

    if (req.method === 'POST' && url.pathname === '/bee/cancel') {
      this.#handleCancel(req, res)
      return
    }

    if (req.method === 'GET' && url.pathname === '/bee/health') {
      this.#handleHealth(req, res)
      return
    }

    res.writeHead(404, { 'Content-Type': 'application/json' })
    res.end(JSON.stringify({ error: 'Not Found' }))
  }

  /** 验证请求认证 */
  #authenticate(req: IncomingMessage): boolean {
    const authHeader = req.headers.authorization
    if (!authHeader) return false

    if (this.#authConfig!.type === 'bearer') {
      const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : ''
      return this.#safeEqual(token, this.#authConfig!.secret)
    }

    if (this.#authConfig!.type === 'hmac') {
      // HMAC 认证：Authorization: HMAC <signature>
      const signature = authHeader.startsWith('HMAC ') ? authHeader.slice(5) : ''
      return this.#safeEqual(signature, this.#authConfig!.secret)
    }

    return false
  }

  /** 时序安全比较，通过 HMAC 摘要避免长度泄露 */
  #safeEqual(a: string, b: string): boolean {
    // 使用固定密钥对双方取 HMAC 摘要，消除长度差异
    const key = 'colony-bee-sdk-timing-safe'
    const digestA = createHmac('sha256', key).update(a).digest()
    const digestB = createHmac('sha256', key).update(b).digest()
    return timingSafeEqual(digestA, digestB)
  }

  async #handleTask(req: IncomingMessage, res: ServerResponse): Promise<void> {
    try {
      const payload = await this.#readBody(req) as TaskAssignPayload
      const taskId = payload.task?.task_id ?? 'unknown'
      this.#logger.info(`Task assigned: ${taskId}`)

      const result = await this.#taskManager.handleTaskAssign(payload)

      res.writeHead(200, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify(result))
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      this.#logger.error(`Task error: ${message}`)
      res.writeHead(500, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify({
        status: 'failure',
        error: { code: 'ERR_UNKNOWN', message, retryable: true }
      }))
    }
  }

  async #handleCancel(req: IncomingMessage, res: ServerResponse): Promise<void> {
    try {
      const payload = await this.#readBody(req) as TaskCancelPayload
      this.#logger.info(`Cancel request: ${payload.task_id ?? 'unknown'}`)
      this.#taskManager.handleTaskCancel(payload)
    } catch { /* ignore parse errors on cancel */ }

    res.writeHead(200, { 'Content-Type': 'application/json' })
    res.end(JSON.stringify({ status: 'cancelled' }))
  }

  #handleHealth(_req: IncomingMessage, res: ServerResponse): void {
    const stats = this.#taskManager.getStats()
    res.writeHead(200, { 'Content-Type': 'application/json' })
    res.end(JSON.stringify({
      status: 'ok',
      active_tasks: stats.activeTasks,
      load: stats.load,
      timestamp: new Date().toISOString()
    }))
  }

  #readBody(req: IncomingMessage): Promise<Record<string, unknown>> {
    return new Promise((resolve, reject) => {
      let body = ''
      req.on('data', (chunk: Buffer) => { body += chunk })
      req.on('end', () => {
        try {
          resolve(body ? JSON.parse(body) as Record<string, unknown> : {})
        } catch (err) {
          reject(err)
        }
      })
      req.on('error', reject)
    })
  }
}
