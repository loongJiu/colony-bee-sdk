import { describe, it, expect, vi, afterEach } from 'vitest'
import { BeeHttpServer } from '../../src/transport/http-server.js'
import { TaskManager } from '../../src/task/task-manager.js'
import { ToolRegistry } from '../../src/task/tool-registry.js'
import { SkillRegistry } from '../../src/skill-registry.js'
import { Logger } from '../../src/logger.js'
import { request } from 'node:http'
import { createHash, createHmac } from 'node:crypto'

const logger = new Logger({ level: 'warn', output: { log: vi.fn(), warn: vi.fn(), error: vi.fn() } })

function createServer(authConfig?: {
  type: 'bearer' | 'hmac'
  secret: string
  hmac?: { max_skew_seconds?: number; nonce_ttl_seconds?: number }
}) {
  const tools = new ToolRegistry()
  const skills = new SkillRegistry()
  const taskManager = new TaskManager({
    maxConcurrent: 1,
    defaultTimeoutSec: 5,
    toolRegistry: tools,
    skillRegistry: skills,
    logger
  })
  taskManager.registerHandler('test', async (ctx) => ({ result: 'ok', taskId: ctx.taskId }))

  return { server: new BeeHttpServer(taskManager, logger, authConfig), taskManager, tools, skills }
}

function fetch(server: BeeHttpServer, method: string, path: string, body?: unknown, headers?: Record<string, string>): Promise<{ status: number; data: any }> {
  const addr = server.address!
  return new Promise((resolve, reject) => {
    const payload = typeof body === 'string' ? body : (body ? JSON.stringify(body) : '')
    const opts = {
      hostname: '127.0.0.1',
      port: addr!.port,
      path,
      method,
      headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(payload).toString(), ...headers }
    }
    const req = request(opts, (res) => {
      let data = ''
      res.on('data', (chunk: Buffer) => { data += chunk })
      res.on('end', () => {
        try {
          resolve({ status: res.statusCode!, data: data ? JSON.parse(data) : null })
        } catch {
          resolve({ status: res.statusCode!, data })
        }
      })
    })
    req.on('error', reject)
    if (payload) req.write(payload)
    req.end()
  })
}

function signHmacRequest(input: {
  method: string
  path: string
  body: string
  timestamp: string
  nonce: string
  secret: string
}): string {
  const bodyHash = createHash('sha256').update(input.body).digest('hex')
  const canonical = `${input.method.toUpperCase()}\n${input.path}\n${bodyHash}\n${input.timestamp}\n${input.nonce}`
  return createHmac('sha256', input.secret).update(canonical).digest('hex')
}

describe('BeeHttpServer', () => {
  let ctx: ReturnType<typeof createServer>

  afterEach(async () => {
    if (ctx?.server) await ctx.server.stop()
  })

  it('启动服务器并返回端口', async () => {
    ctx = createServer()
    const { port } = await ctx.server.start(0)
    expect(port).toBeGreaterThan(0)
  })

  it('POST /bee/task 执行任务', async () => {
    ctx = createServer()
    await ctx.server.start(0)

    const res = await fetch(ctx.server, 'POST', '/bee/task', {
      task: { task_id: 't1', name: 'test', input: 'hello' }
    })

    expect(res.status).toBe(200)
    expect(res.data.status).toBe('success')
    expect(res.data.output).toEqual({ result: 'ok', taskId: 't1' })
  })

  it('POST /bee/cancel 取消任务', async () => {
    ctx = createServer()
    await ctx.server.start(0)

    const res = await fetch(ctx.server, 'POST', '/bee/cancel', { task_id: 't1' })
    expect(res.status).toBe(200)
    expect(res.data.status).toBe('cancelled')
  })

  it('GET /bee/health 返回健康状态', async () => {
    ctx = createServer()
    await ctx.server.start(0)

    const res = await fetch(ctx.server, 'GET', '/bee/health')
    expect(res.status).toBe(200)
    expect(res.data.status).toBe('ok')
    expect(res.data).toHaveProperty('active_tasks')
    expect(res.data).toHaveProperty('load')
  })

  it('未知路由返回 404', async () => {
    ctx = createServer()
    await ctx.server.start(0)

    const res = await fetch(ctx.server, 'GET', '/unknown')
    expect(res.status).toBe(404)
    expect(res.data.error).toBe('Not Found')
  })

  it('CORS 头存在', async () => {
    ctx = createServer()
    await ctx.server.start(0)

    const res = await fetch(ctx.server, 'GET', '/bee/health')
    // fetch 辅助函数读取的是响应，但 CORS 头在 response 中
    // 这里我们直接测试 OPTIONS
    const addr = ctx.server.address!
    return new Promise<void>((resolve) => {
      const req = request({
        hostname: '127.0.0.1',
        port: addr!.port,
        path: '/bee/health',
        method: 'OPTIONS'
      }, (res) => {
        expect(res.headers['access-control-allow-origin']).toBe('*')
        expect(res.statusCode).toBe(204)
        res.resume()
        resolve()
      })
      req.end()
    })
  })

  describe('端点认证', () => {
    it('bearer 认证 - 无 Authorization 头返回 401', async () => {
      ctx = createServer({ type: 'bearer', secret: 'test-secret' })
      await ctx.server.start(0)

      const res = await fetch(ctx.server, 'POST', '/bee/task', {
        task: { task_id: 't1', name: 'test', input: 'hello' }
      })
      expect(res.status).toBe(401)
    })

    it('bearer 认证 - 错误 token 返回 401', async () => {
      ctx = createServer({ type: 'bearer', secret: 'test-secret' })
      await ctx.server.start(0)

      const res = await fetch(ctx.server, 'POST', '/bee/task', {
        task: { task_id: 't1', name: 'test', input: 'hello' }
      }, { Authorization: 'Bearer wrong-secret' })
      expect(res.status).toBe(401)
    })

    it('bearer 认证 - 正确 token 放行', async () => {
      ctx = createServer({ type: 'bearer', secret: 'test-secret' })
      await ctx.server.start(0)

      const res = await fetch(ctx.server, 'POST', '/bee/task', {
        task: { task_id: 't1', name: 'test', input: 'hello' }
      }, { Authorization: 'Bearer test-secret' })
      expect(res.status).toBe(200)
      expect(res.data.status).toBe('success')
    })

    it('GET /bee/health 不需要认证', async () => {
      ctx = createServer({ type: 'bearer', secret: 'test-secret' })
      await ctx.server.start(0)

      const res = await fetch(ctx.server, 'GET', '/bee/health')
      expect(res.status).toBe(200)
    })

    it('hmac 认证 - 请求签名正确时放行', async () => {
      ctx = createServer({ type: 'hmac', secret: 'hmac-secret' })
      await ctx.server.start(0)

      const body = JSON.stringify({ task: { task_id: 't1', name: 'test', input: 'hello' } })
      const timestamp = `${Math.floor(Date.now() / 1000)}`
      const nonce = 'nonce-pass'
      const signature = signHmacRequest({
        method: 'POST',
        path: '/bee/task',
        body,
        timestamp,
        nonce,
        secret: 'hmac-secret',
      })

      const res = await fetch(ctx.server, 'POST', '/bee/task', body, {
        Authorization: `HMAC ${signature}`,
        'X-Bee-Timestamp': timestamp,
        'X-Bee-Nonce': nonce,
      })
      expect(res.status).toBe(200)
      expect(res.data.status).toBe('success')
    })

    it('hmac 认证 - 请求体被篡改时拒绝', async () => {
      ctx = createServer({ type: 'hmac', secret: 'hmac-secret' })
      await ctx.server.start(0)

      const signedBody = JSON.stringify({ task: { task_id: 't1', name: 'test', input: 'hello' } })
      const tamperedBody = JSON.stringify({ task: { task_id: 't1', name: 'test', input: 'tampered' } })
      const timestamp = `${Math.floor(Date.now() / 1000)}`
      const nonce = 'nonce-tampered'
      const signature = signHmacRequest({
        method: 'POST',
        path: '/bee/task',
        body: signedBody,
        timestamp,
        nonce,
        secret: 'hmac-secret',
      })

      const res = await fetch(ctx.server, 'POST', '/bee/task', tamperedBody, {
        Authorization: `HMAC ${signature}`,
        'X-Bee-Timestamp': timestamp,
        'X-Bee-Nonce': nonce,
      })
      expect(res.status).toBe(401)
    })

    it('hmac 认证 - 过期时间戳请求拒绝', async () => {
      ctx = createServer({ type: 'hmac', secret: 'hmac-secret', hmac: { max_skew_seconds: 5 } })
      await ctx.server.start(0)

      const body = JSON.stringify({ task: { task_id: 't1', name: 'test', input: 'hello' } })
      const timestamp = `${Math.floor(Date.now() / 1000) - 60}`
      const nonce = 'nonce-expired'
      const signature = signHmacRequest({
        method: 'POST',
        path: '/bee/task',
        body,
        timestamp,
        nonce,
        secret: 'hmac-secret',
      })

      const res = await fetch(ctx.server, 'POST', '/bee/task', body, {
        Authorization: `HMAC ${signature}`,
        'X-Bee-Timestamp': timestamp,
        'X-Bee-Nonce': nonce,
      })
      expect(res.status).toBe(401)
    })

    it('hmac 认证 - nonce 重放请求拒绝', async () => {
      ctx = createServer({ type: 'hmac', secret: 'hmac-secret' })
      await ctx.server.start(0)

      const body = JSON.stringify({ task: { task_id: 't1', name: 'test', input: 'hello' } })
      const timestamp = `${Math.floor(Date.now() / 1000)}`
      const nonce = 'nonce-replay'
      const signature = signHmacRequest({
        method: 'POST',
        path: '/bee/task',
        body,
        timestamp,
        nonce,
        secret: 'hmac-secret',
      })
      const headers = {
        Authorization: `HMAC ${signature}`,
        'X-Bee-Timestamp': timestamp,
        'X-Bee-Nonce': nonce,
      }

      const first = await fetch(ctx.server, 'POST', '/bee/task', body, headers)
      expect(first.status).toBe(200)

      const replay = await fetch(ctx.server, 'POST', '/bee/task', body, headers)
      expect(replay.status).toBe(401)
    })
  })
})
