/**
 * bee.yaml 解析和校验
 *
 * 使用 js-yaml 读取配置文件，Zod 校验结构
 */

import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import yaml from 'js-yaml'
import { z } from 'zod'

/**
 * bee.yaml Zod Schema
 *
 * 默认值与 colony-queen/src/models/agent.js createAgentRecord 保持一致
 */
export const BeeSpecSchema = z.object({
  identity: z.object({
    role: z.enum(['worker', 'scout']),
    name: z.string().min(1),
    description: z.string().optional().default(''),
    tags: z.array(z.string()).optional().default([])
  }),
  runtime: z.object({
    endpoint: z.string().optional(),
    protocol: z.literal('http').optional().default('http'),
    health_check: z.object({
      enabled: z.boolean().optional().default(false),
      port: z.number().int().positive().optional().default(9010),
      path: z.string().optional().default('/health'),
    }).optional().default({}),
  }).optional().default({}),
  capabilities: z.array(z.string()).min(1),
  model: z.object({ name: z.string() }).passthrough().optional().default(undefined as any),
  tools: z.array(z.object({ id: z.string() }).passthrough()).optional().default([]),
  skills: z.array(z.object({ id: z.string() }).passthrough()).optional().default([]),
  constraints: z.object({
    max_concurrent: z.number().int().positive().optional().default(1),
    timeout_default: z.number().int().positive().optional().default(30),
    queue_max: z.number().int().positive().optional().default(100),
    queue_strategy: z.enum(['fifo', 'priority']).optional().default('fifo'),
    retry_max: z.number().int().positive().optional().default(3)
  }).optional().default({}),
  security: z.object({
    endpoint_auth: z.object({
      type: z.enum(['bearer', 'hmac']),
      secret: z.string().min(1),
    }).optional()
  }).optional().default({}),
  heartbeat: z.object({
    interval: z.number().int().positive().optional().default(10)
  }).optional().default({})
})

export type BeeSpec = z.infer<typeof BeeSpecSchema>

export class SpecLoader {
  /** 加载并校验 bee.yaml（支持环境变量插值） */
  static async load(yamlPath: string): Promise<BeeSpec> {
    const absPath = resolve(yamlPath)
    const content = await readFile(absPath, 'utf-8')
    const raw = yaml.load(content) as unknown
    const interpolated = SpecLoader.#interpolateEnvVars(raw)
    const spec = BeeSpecSchema.parse(interpolated)
    return spec
  }

  /**
   * 递归替换对象中的环境变量引用
   * 支持 ${VAR} 和 ${VAR:-default} 语法
   */
  static #interpolateEnvVars(obj: unknown): unknown {
    if (typeof obj === 'string') {
      return obj.replace(/\$\{([^}]+)\}/g, (_, expr: string) => {
        const [varName, defaultValue] = expr.split(':-') as [string, string | undefined]
        return process.env[varName] ?? defaultValue ?? ''
      })
    }
    if (Array.isArray(obj)) {
      return obj.map(item => SpecLoader.#interpolateEnvVars(item))
    }
    if (obj !== null && typeof obj === 'object') {
      const result: Record<string, unknown> = {}
      for (const [key, value] of Object.entries(obj as Record<string, unknown>)) {
        result[key] = SpecLoader.#interpolateEnvVars(value)
      }
      return result
    }
    return obj
  }
}
