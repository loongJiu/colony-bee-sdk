import { describe, it, expect } from 'vitest'
import { BeeSpecSchema, SpecLoader } from '../src/spec-loader.js'
import { writeFile, mkdir, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'

const VALID_SPEC = {
  identity: { role: 'worker' as const, name: 'test-agent' },
  capabilities: ['code_generation']
}

describe('BeeSpecSchema', () => {
  it('最小合法 spec 通过校验', () => {
    const spec = BeeSpecSchema.parse(VALID_SPEC)
    expect(spec.identity.role).toBe('worker')
    expect(spec.identity.name).toBe('test-agent')
    expect(spec.capabilities).toEqual(['code_generation'])
  })

  it('可选字段有默认值', () => {
    const spec = BeeSpecSchema.parse(VALID_SPEC)
    expect(spec.identity.description).toBe('')
    expect(spec.identity.tags).toEqual([])
    expect(spec.runtime.protocol).toBe('http')
    expect(spec.tools).toEqual([])
    expect(spec.skills).toEqual([])
    expect(spec.constraints.max_concurrent).toBe(1)
    expect(spec.constraints.timeout_default).toBe(30)
    expect(spec.constraints.queue_max).toBe(100)
    expect(spec.constraints.retry_max).toBe(3)
    expect(spec.security.allow_insecure_endpoint).toBe(false)
    expect(spec.heartbeat.interval).toBe(10)
  })

  it('完整 spec 通过校验', () => {
    const spec = BeeSpecSchema.parse({
      identity: { role: 'scout', name: 'scout-1', description: 'desc', tags: ['a'] },
      runtime: { protocol: 'http' },
      capabilities: ['search'],
      model: { name: 'glm-4' },
      tools: [{ id: 'tool1' }],
      skills: [{ id: 'skill1' }],
      constraints: { max_concurrent: 5, timeout_default: 60, queue_max: 200, retry_max: 5 },
      heartbeat: { interval: 30 }
    })
    expect(spec.identity.role).toBe('scout')
    expect(spec.model!.name).toBe('glm-4')
    expect(spec.constraints.max_concurrent).toBe(5)
  })

  it('缺少 identity.role 抛错', () => {
    expect(() => BeeSpecSchema.parse({
      identity: { name: 'x' },
      capabilities: ['a']
    })).toThrow()
  })

  it('缺少 identity.name 抛错', () => {
    expect(() => BeeSpecSchema.parse({
      identity: { role: 'worker' },
      capabilities: ['a']
    })).toThrow()
  })

  it('缺少 capabilities 抛错', () => {
    expect(() => BeeSpecSchema.parse({
      identity: { role: 'worker', name: 'x' }
    })).toThrow()
  })

  it('capabilities 为空数组抛错', () => {
    expect(() => BeeSpecSchema.parse({
      ...VALID_SPEC,
      capabilities: []
    })).toThrow()
  })

  it('无效 role 抛错', () => {
    expect(() => BeeSpecSchema.parse({
      ...VALID_SPEC,
      identity: { role: 'admin', name: 'x' }
    })).toThrow()
  })
})

describe('SpecLoader.load', () => {
  const fixtureDir = join(tmpdir(), 'colony-bee-sdk-test')

  it('从 YAML 文件加载 spec', async () => {
    await mkdir(fixtureDir, { recursive: true })
    const yamlPath = join(fixtureDir, 'bee.yaml')
    await writeFile(yamlPath, [
      'identity:',
      '  role: worker',
      '  name: yaml-agent',
      'capabilities:',
      '  - test',
    ].join('\n'))

    try {
      const spec = await SpecLoader.load(yamlPath)
      expect(spec.identity.name).toBe('yaml-agent')
      expect(spec.identity.role).toBe('worker')
      expect(spec.capabilities).toEqual(['test'])
    } finally {
      await rm(fixtureDir, { recursive: true })
    }
  })

  it('文件不存在时抛错', async () => {
    await expect(SpecLoader.load('/nonexistent/bee.yaml')).rejects.toThrow()
  })

  it('环境变量插值 ${VAR}', async () => {
    process.env.TEST_BEE_NAME = 'env-agent'
    await mkdir(fixtureDir, { recursive: true })
    const yamlPath = join(fixtureDir, 'bee-env.yaml')
    await writeFile(yamlPath, [
      'identity:',
      '  role: worker',
      '  name: ${TEST_BEE_NAME}',
      'capabilities:',
      '  - test',
    ].join('\n'))

    try {
      const spec = await SpecLoader.load(yamlPath)
      expect(spec.identity.name).toBe('env-agent')
    } finally {
      delete process.env.TEST_BEE_NAME
      await rm(fixtureDir, { recursive: true })
    }
  })

  it('环境变量插值 ${VAR:-default}', async () => {
    delete process.env.TEST_MISSING_VAR
    await mkdir(fixtureDir, { recursive: true })
    const yamlPath = join(fixtureDir, 'bee-default.yaml')
    await writeFile(yamlPath, [
      'identity:',
      '  role: worker',
      '  name: ${TEST_MISSING_VAR:-fallback-name}',
      'capabilities:',
      '  - test',
    ].join('\n'))

    try {
      const spec = await SpecLoader.load(yamlPath)
      expect(spec.identity.name).toBe('fallback-name')
    } finally {
      await rm(fixtureDir, { recursive: true })
    }
  })

  it('security 配置通过校验', async () => {
    await mkdir(fixtureDir, { recursive: true })
    const yamlPath = join(fixtureDir, 'bee-sec.yaml')
    await writeFile(yamlPath, [
      'identity:',
      '  role: worker',
      '  name: sec-agent',
      'capabilities:',
      '  - test',
      'security:',
      '  endpoint_auth:',
      '    type: hmac',
      '    secret: my-secret',
      '    hmac:',
      '      max_skew_seconds: 120',
      '      nonce_ttl_seconds: 60',
      '  allow_insecure_endpoint: false',
    ].join('\n'))

    try {
      const spec = await SpecLoader.load(yamlPath)
      expect(spec.security?.endpoint_auth?.type).toBe('hmac')
      expect(spec.security?.endpoint_auth?.secret).toBe('my-secret')
      expect(spec.security?.endpoint_auth?.hmac?.max_skew_seconds).toBe(120)
      expect(spec.security?.endpoint_auth?.hmac?.nonce_ttl_seconds).toBe(60)
      expect(spec.security?.allow_insecure_endpoint).toBe(false)
    } finally {
      await rm(fixtureDir, { recursive: true })
    }
  })
})
