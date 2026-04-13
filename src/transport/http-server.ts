/**
 * 内嵌 HTTP 服务器
 *
 * 使用 node:http 创建轻量服务器，处理 Queen 发来的请求：
 *   POST /bee/task   - 接收任务分配
 *   POST /bee/cancel - 取消任务
 *   GET  /bee/health - 健康检查
 */

import { createServer, type IncomingMessage, type ServerResponse, type Server } from 'node:http'
import { createHash, createHmac, timingSafeEqual } from 'node:crypto'
import { TaskManager } from '../task/task-manager.js'
import { Logger } from '../logger.js'
import type { ServerAddress, TaskAssignPayload, TaskCancelPayload } from '../types.js'

/** 端点认证配置 */
export interface EndpointAuthConfig {
  type: 'bearer' | 'hmac'
  secret: string
  hmac?: {
    max_skew_seconds?: number
    nonce_ttl_seconds?: number
  }
}

const DEFAULT_HMAC_MAX_SKEW_SECONDS = 300
const DEFAULT_HMAC_NONCE_TTL_SECONDS = 300

export class BeeHttpServer {
  readonly #taskManager: TaskManager
  readonly #logger: Logger
  readonly #authConfig: EndpointAuthConfig | null
  readonly #nonceCache: Map<string, number> = new Map()
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
        this.#handleRequest(req, res).catch((err: unknown) => {
          const message = err instanceof Error ? err.message : String(err)
          this.#logger.error(`Request handling failed: ${message}`)
          if (!res.headersSent) {
            res.writeHead(500, { 'Content-Type': 'application/json' })
          }
          res.end(JSON.stringify({ error: 'Internal Server Error' }))
        })
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

  async #handleRequest(req: IncomingMessage, res: ServerResponse): Promise<void> {
    res.setHeader('Access-Control-Allow-Origin', '*')
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS')
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, X-Bee-Timestamp, X-Bee-Nonce')

    if (req.method === 'OPTIONS') {
      res.writeHead(204)
      res.end()
      return
    }

    const url = new URL(req.url ?? '/', `http://${req.headers.host ?? '127.0.0.1'}`)
    const isPost = req.method === 'POST'
    const rawBody = isPost ? await this.#readRawBody(req) : ''

    // 端点认证检查（仅对 POST 端点生效）
    if (isPost && this.#authConfig && !this.#authenticate(req, url.pathname, rawBody)) {
      this.#logger.warn(`Unauthorized request to ${req.url}`)
      res.writeHead(401, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify({ error: 'Unauthorized' }))
      return
    }

    if (isPost && url.pathname === '/bee/task') {
      await this.#handleTask(rawBody, res)
      return
    }

    if (isPost && url.pathname === '/bee/cancel') {
      await this.#handleCancel(rawBody, res)
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
  #authenticate(req: IncomingMessage, path: string, rawBody: string): boolean {
    const authHeader = req.headers.authorization
    if (!authHeader) return false

    if (this.#authConfig!.type === 'bearer') {
      const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : ''
      return this.#safeEqual(token, this.#authConfig!.secret)
    }

    if (this.#authConfig!.type === 'hmac') {
      const signature = authHeader.startsWith('HMAC ') ? authHeader.slice(5) : ''
      if (!signature) return false

      const timestamp = req.headers['x-bee-timestamp']
      const nonce = req.headers['x-bee-nonce']
      if (typeof timestamp !== 'string' || typeof nonce !== 'string') return false

      const maxSkewMs = (this.#authConfig!.hmac?.max_skew_seconds ?? DEFAULT_HMAC_MAX_SKEW_SECONDS) * 1000
      const nonceTtlMs = (this.#authConfig!.hmac?.nonce_ttl_seconds ?? DEFAULT_HMAC_NONCE_TTL_SECONDS) * 1000
      const now = Date.now()
      const tsMs = this.#parseTimestamp(timestamp)
      if (!tsMs) return false
      if (Math.abs(now - tsMs) > maxSkewMs) return false

      this.#cleanupExpiredNonces(now)
      if (this.#nonceCache.has(nonce)) return false

      const bodyHash = createHash('sha256').update(rawBody).digest('hex')
      const canonical = `${req.method?.toUpperCase() ?? ''}\n${path}\n${bodyHash}\n${timestamp}\n${nonce}`
      const expected = createHmac('sha256', this.#authConfig!.secret).update(canonical).digest('hex')
      const matched = this.#safeEqual(signature, expected)
      if (!matched) return false

      this.#nonceCache.set(nonce, now + nonceTtlMs)
      return true
    }

    return false
  }

  #parseTimestamp(input: string): number | null {
    if (/^\d+$/.test(input)) {
      const num = Number(input)
      if (Number.isNaN(num)) return null
      return input.length <= 10 ? num * 1000 : num
    }
    const parsed = Date.parse(input)
    return Number.isNaN(parsed) ? null : parsed
  }

  #cleanupExpiredNonces(now: number): void {
    for (const [nonce, expiresAt] of this.#nonceCache.entries()) {
      if (expiresAt <= now) {
        this.#nonceCache.delete(nonce)
      }
    }
  }

  /** 时序安全比较，通过 HMAC 摘要避免长度泄露 */
  #safeEqual(a: string, b: string): boolean {
    // 使用固定密钥对双方取 HMAC 摘要，消除长度差异
    const key = 'colony-bee-sdk-timing-safe'
    const digestA = createHmac('sha256', key).update(a).digest()
    const digestB = createHmac('sha256', key).update(b).digest()
    return timingSafeEqual(digestA, digestB)
  }

  async #handleTask(rawBody: string, res: ServerResponse): Promise<void> {
    try {
      const payload = this.#parseJsonBody(rawBody) as TaskAssignPayload
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

  async #handleCancel(rawBody: string, res: ServerResponse): Promise<void> {
    try {
      const payload = this.#parseJsonBody(rawBody) as TaskCancelPayload
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

  #parseJsonBody(rawBody: string): Record<string, unknown> {
    if (!rawBody) return {}
    return JSON.parse(rawBody) as Record<string, unknown>
  }

  #readRawBody(req: IncomingMessage): Promise<string> {
    return new Promise((resolve, reject) => {
      let body = ''
      req.on('data', (chunk: Buffer) => { body += chunk })
      req.on('end', () => {
        resolve(body)
      })
      req.on('error', reject)
    })
  }
}
