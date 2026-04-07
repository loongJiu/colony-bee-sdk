/**
 * 内嵌 HTTP 服务器
 *
 * 使用 node:http 创建轻量服务器，处理 Queen 发来的请求：
 *   POST /bee/task   - 接收任务分配
 *   POST /bee/cancel - 取消任务
 *   GET  /bee/health - 健康检查
 */

import { createServer } from 'node:http'

export class BeeHttpServer {
  /** @type {import('../task/task-manager.js').TaskManager} */
  #taskManager
  /** @type {import('../logger.js').Logger} */
  #logger
  /** @type {import('node:http').Server|null} */
  #server = null

  /**
   * @param {import('../task/task-manager.js').TaskManager} taskManager
   * @param {import('../logger.js').Logger} logger
   */
  constructor(taskManager, logger) {
    this.#taskManager = taskManager
    this.#logger = logger.child({ component: 'http-server' })
  }

  /**
   * 启动 HTTP 服务器
   *
   * @param {number} [port=0] - 端口号，0 表示自动分配
   * @param {string} [host='0.0.0.0'] - 绑定地址
   * @returns {Promise<{port: number}>}
   */
  start(port = 0, host = '0.0.0.0') {
    return new Promise((resolve, reject) => {
      this.#server = createServer((req, res) => {
        this.#handleRequest(req, res)
      })

      this.#server.on('error', reject)

      this.#server.listen(port, host, () => {
        const addr = this.#server.address()
        this.#logger.info(`HTTP server listening on ${addr.address}:${addr.port}`)
        resolve({ port: addr.port })
      })
    })
  }

  /**
   * 停止 HTTP 服务器
   *
   * @returns {Promise<void>}
   */
  stop() {
    return new Promise((resolve) => {
      if (!this.#server) return resolve()
      this.#server.close(() => {
        this.#logger.info('HTTP server stopped')
        this.#server = null
        resolve()
      })
    })
  }

  /**
   * 获取服务器地址信息
   *
   * @returns {{port: number, address: string}|null}
   */
  get address() {
    if (!this.#server) return null
    return this.#server.address()
  }

  /**
   * 处理 HTTP 请求
   *
   * @param {import('node:http').IncomingMessage} req
   * @param {import('node:http').ServerResponse} res
   */
  #handleRequest(req, res) {
    // CORS
    res.setHeader('Access-Control-Allow-Origin', '*')
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS')
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type')

    if (req.method === 'OPTIONS') {
      res.writeHead(204)
      return res.end()
    }

    const url = new URL(req.url, `http://${req.headers.host}`)

    if (req.method === 'POST' && url.pathname === '/bee/task') {
      return this.#handleTask(req, res)
    }

    if (req.method === 'POST' && url.pathname === '/bee/cancel') {
      return this.#handleCancel(req, res)
    }

    if (req.method === 'GET' && url.pathname === '/bee/health') {
      return this.#handleHealth(req, res)
    }

    res.writeHead(404, { 'Content-Type': 'application/json' })
    res.end(JSON.stringify({ error: 'Not Found' }))
  }

  /**
   * 处理 POST /bee/task
   */
  async #handleTask(req, res) {
    try {
      const payload = await this.#readBody(req)
      this.#logger.info(`Task assigned: ${payload.task?.task_id ?? 'unknown'}`)

      const result = await this.#taskManager.handleTaskAssign(payload)

      res.writeHead(200, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify(result))
    } catch (err) {
      this.#logger.error(`Task error: ${err.message}`)
      res.writeHead(500, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify({
        status: 'failure',
        error: { code: 'ERR_UNKNOWN', message: err.message, retryable: true }
      }))
    }
  }

  /**
   * 处理 POST /bee/cancel
   */
  async #handleCancel(req, res) {
    try {
      const payload = await this.#readBody(req)
      this.#logger.info(`Cancel request: ${payload.task_id ?? 'unknown'}`)
      this.#taskManager.handleTaskCancel(payload)
    } catch { /* ignore parse errors on cancel */ }

    res.writeHead(200, { 'Content-Type': 'application/json' })
    res.end(JSON.stringify({ status: 'cancelled' }))
  }

  /**
   * 处理 GET /bee/health
   */
  #handleHealth(_req, res) {
    const stats = this.#taskManager.getStats()
    res.writeHead(200, { 'Content-Type': 'application/json' })
    res.end(JSON.stringify({
      status: 'ok',
      active_tasks: stats.activeTasks,
      load: stats.load,
      timestamp: new Date().toISOString()
    }))
  }

  /**
   * 读取请求体 JSON
   *
   * @param {import('node:http').IncomingMessage} req
   * @returns {Promise<Object>}
   */
  #readBody(req) {
    return new Promise((resolve, reject) => {
      let body = ''
      req.on('data', (chunk) => { body += chunk })
      req.on('end', () => {
        try {
          resolve(body ? JSON.parse(body) : {})
        } catch (err) {
          reject(err)
        }
      })
      req.on('error', reject)
    })
  }
}
