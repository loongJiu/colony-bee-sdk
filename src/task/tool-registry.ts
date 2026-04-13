/**
 * 工具注册表
 */

import type { ZodType } from 'zod'
import { zodToJsonSchema } from 'zod-to-json-schema'
import type { ToolDefinition, ToolSchema } from '../types.js'

/** 完整工具定义（带 schema 的注册参数） */
export interface FullToolDefinition {
  description?: string
  inputSchema?: ZodType
  outputSchema?: ZodType
  execute: (input: unknown) => unknown | Promise<unknown>
}

export class ToolRegistry {
  readonly #tools: Map<string, ToolDefinition> = new Map()

  /**
   * 注册工具
   *
   * 支持两种方式：
   * 1. 函数简写（向后兼容）：register('tool', (input) => result)
   * 2. 带 schema 的完整定义：register('tool', { description, inputSchema, outputSchema, execute })
   */
  register(id: string, handlerOrDef: ((input: unknown) => unknown) | FullToolDefinition | Record<string, unknown>): void {
    if (typeof handlerOrDef === 'function') {
      this.#tools.set(id, { handler: handlerOrDef })
    } else if (typeof (handlerOrDef as FullToolDefinition).execute === 'function') {
      // 新格式：带 schema 的完整工具定义
      const def = handlerOrDef as FullToolDefinition
      this.#tools.set(id, {
        handler: def.execute,
        description: def.description,
        inputSchema: def.inputSchema,
        outputSchema: def.outputSchema,
      })
    } else {
      // 旧格式：纯 schema 对象（向后兼容）
      this.#tools.set(id, { schema: handlerOrDef as Record<string, unknown> })
    }
  }

  /** 获取工具 */
  get(id: string): ToolDefinition | undefined {
    return this.#tools.get(id)
  }

  /** 检查工具是否存在 */
  has(id: string): boolean {
    return this.#tools.has(id)
  }

  /** 列出所有工具 ID */
  list(): string[] {
    return [...this.#tools.keys()]
  }

  /**
   * 返回所有已注册工具的 JSON Schema（供 LLM 调用）
   * 格式兼容 OpenAI function calling / Anthropic tool use
   */
  getToolSchemas(): ToolSchema[] {
    const schemas: ToolSchema[] = []

    for (const [id, tool] of this.#tools) {
      const entry: ToolSchema = {
        name: id,
        description: tool.description,
        parameters: {
          type: 'object' as const,
          properties: {},
        },
      }

      if (tool.inputSchema) {
        const jsonSchema = zodToJsonSchema(tool.inputSchema, { target: 'openApi3' }) as Record<string, unknown>
        if (jsonSchema.properties && typeof jsonSchema.properties === 'object') {
          entry.parameters.properties = jsonSchema.properties as Record<string, unknown>
        }
        if (Array.isArray(jsonSchema.required)) {
          entry.parameters.required = jsonSchema.required as string[]
        }
      }

      schemas.push(entry)
    }

    return schemas
  }
}
