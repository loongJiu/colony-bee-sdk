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
    protocol: z.literal('http').optional().default('http')
  }).optional().default({}),
  capabilities: z.array(z.string()).min(1),
  model: z.object({ name: z.string() }).passthrough().optional().default(undefined as any),
  tools: z.array(z.object({ id: z.string() }).passthrough()).optional().default([]),
  skills: z.array(z.object({ id: z.string() }).passthrough()).optional().default([]),
  constraints: z.object({
    max_concurrent: z.number().int().positive().optional().default(1),
    timeout_default: z.number().int().positive().optional().default(30),
    queue_max: z.number().int().positive().optional().default(100),
    retry_max: z.number().int().positive().optional().default(3)
  }).optional().default({}),
  heartbeat: z.object({
    interval: z.number().int().positive().optional().default(10)
  }).optional().default({})
})

export type BeeSpec = z.infer<typeof BeeSpecSchema>

export class SpecLoader {
  /** 加载并校验 bee.yaml */
  static async load(yamlPath: string): Promise<BeeSpec> {
    const absPath = resolve(yamlPath)
    const content = await readFile(absPath, 'utf-8')
    const raw = yaml.load(content) as unknown
    const spec = BeeSpecSchema.parse(raw)
    return spec
  }
}
