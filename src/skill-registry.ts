/**
 * 技能注册表
 */

import type { SkillDefinition } from './types.js'

export class SkillRegistry {
  readonly #skills: Map<string, SkillDefinition> = new Map()

  /** 定义技能 */
  define(id: string, config: SkillDefinition): void {
    this.#skills.set(id, config)
  }

  /** 获取技能 */
  get(id: string): SkillDefinition | undefined {
    return this.#skills.get(id)
  }

  /** 激活（执行）技能 */
  async activate(id: string, input?: unknown): Promise<unknown> {
    const skill = this.#skills.get(id)
    if (!skill) throw new Error(`Skill not found: ${id}`)
    if (typeof skill.handler === 'function') {
      return skill.handler(input)
    }
    return skill.prompt ?? skill.description ?? ''
  }

  /** 列出所有技能 ID */
  list(): string[] {
    return [...this.#skills.keys()]
  }
}
