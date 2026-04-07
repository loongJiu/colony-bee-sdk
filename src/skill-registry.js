/**
 * 技能注册表
 */

export class SkillRegistry {
  /** @type {Map<string, Object>} */
  #skills = new Map()

  /**
   * 定义技能
   *
   * @param {string} id - 技能 ID
   * @param {Object} config - 技能配置（含 handler, description 等）
   */
  define(id, config) {
    this.#skills.set(id, config)
  }

  /**
   * 获取技能
   *
   * @param {string} id
   * @returns {Object|undefined}
   */
  get(id) {
    return this.#skills.get(id)
  }

  /**
   * 激活（执行）技能
   *
   * @param {string} id
   * @param {*} [input]
   * @returns {Promise<*>}
   */
  async activate(id, input) {
    const skill = this.#skills.get(id)
    if (!skill) throw new Error(`Skill not found: ${id}`)
    if (typeof skill.handler === 'function') {
      return skill.handler(input)
    }
    // 如果是 prompt_inject 类型，返回 prompt
    return skill.prompt ?? skill.description ?? ''
  }

  /**
   * 列出所有技能 ID
   *
   * @returns {string[]}
   */
  list() {
    return [...this.#skills.keys()]
  }
}
