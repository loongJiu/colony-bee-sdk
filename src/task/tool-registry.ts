/**
 * 工具注册表
 */

import type { ToolDefinition } from '../types.js'

export class ToolRegistry {
  readonly #tools: Map<string, ToolDefinition> = new Map()

  /** 注册工具 */
  register(id: string, handlerOrSchema: ((input: unknown) => unknown) | Record<string, unknown>): void {
    if (typeof handlerOrSchema === 'function') {
      this.#tools.set(id, { handler: handlerOrSchema })
    } else {
      this.#tools.set(id, { schema: handlerOrSchema })
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
}
