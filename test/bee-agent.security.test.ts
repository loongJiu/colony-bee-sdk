import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { BeeAgent } from '../src/bee-agent.js'
import { BeeSpecSchema } from '../src/spec-loader.js'
import { Logger } from '../src/logger.js'

const originalEnv = { ...process.env }
const logger = new Logger({ level: 'warn', output: { log: vi.fn(), warn: vi.fn(), error: vi.fn() } })

describe('BeeAgent 安全默认', () => {
  beforeEach(() => {
    process.env = { ...originalEnv }
    delete process.env.BEE_ENDPOINT_AUTH_TYPE
    delete process.env.BEE_ENDPOINT_AUTH_SECRET
    delete process.env.BEE_ALLOW_INSECURE_ENDPOINT
  })

  afterEach(() => {
    process.env = { ...originalEnv }
  })

  it('fromEnv 在生产环境默认要求 endpoint_auth', () => {
    process.env.NODE_ENV = 'production'
    process.env.BEE_CAPABILITIES = 'test'

    expect(() => BeeAgent.fromEnv()).toThrow('Endpoint authentication is required in production')
  })

  it('fromEnv 允许通过显式开关放开裸端点', () => {
    process.env.NODE_ENV = 'production'
    process.env.BEE_CAPABILITIES = 'test'
    process.env.BEE_ALLOW_INSECURE_ENDPOINT = 'true'

    expect(() => BeeAgent.fromEnv()).not.toThrow()
  })

  it('join 在生产环境拒绝未配置认证的 spec', async () => {
    process.env.NODE_ENV = 'production'
    const spec = BeeSpecSchema.parse({
      identity: { role: 'worker', name: 'agent-security-test' },
      capabilities: ['test'],
    })
    const agent = new BeeAgent(spec, logger)

    await expect(agent.join('http://queen.test', 'token')).rejects.toThrow('Endpoint authentication is required in production')
  })
})
