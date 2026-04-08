import { describe, it, expect, vi, afterEach } from 'vitest'
import { BeeHttpServer } from '../../src/transport/http-server.js'
import { TaskManager } from '../../src/task/task-manager.js'
import { ToolRegistry } from '../../src/task/tool-registry.js'
import { SkillRegistry } from '../../src/skill-registry.js'
import { Logger } from '../../src/logger.js'
import { request } from 'node:http'

const logger = new Logger({ level: 'warn', output: { log: vi.fn(), warn: vi.fn(), error: vi.fn() } })

function createServer() {
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

  return { server: new BeeHttpServer(taskManager, logger), taskManager, tools, skills }
}

function fetch(server: BeeHttpServer, method: string, path: string, body?: unknown): Promise<{ status: number; data: any }> {
  const addr = server.address!
  return new Promise((resolve, reject) => {
    const opts = {
      hostname: '127.0.0.1',
      port: addr!.port,
      path,
      method,
      headers: { 'Content-Type': 'application/json' }
    }
    const req = request(opts, (res) => {
      let data = ''
      res.on('data', (chunk: Buffer) => { data += chunk })
      res.on('end', () => {
        resolve({ status: res.statusCode!, data: data ? JSON.parse(data) : null })
      })
    })
    req.on('error', reject)
    if (body) req.write(JSON.stringify(body))
    req.end()
  })
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
})
