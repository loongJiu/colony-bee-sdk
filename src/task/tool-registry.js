/**
 * 工具注册表
 */

export class ToolRegistry {
  /** @type {Map<string, {handler?: Function, schema?: Object}>} */
  #tools = new Map()

  /**
   * 注册工具
   *
   * @param {string} id - 工具 ID
   * @param {Function|Object} handlerOrSchema - 处理函数或 schema 定义
   */
  register(id, handlerOrSchema) {
    if (typeof handlerOrSchema === 'function') {
      this.#tools.set(id, { handler: handlerOrSchema })
    } else {
      this.#tools.set(id, { schema: handlerOrSchema })
    }
  }

  /**
   * 获取工具
   *
   * @param {string} id
   * @returns {{handler?: Function, schema?: Object}|undefined}
   */
  get(id) {
    return this.#tools.get(id)
  }

  /**
   * 检查工具是否存在
   *
   * @param {string} id
   * @returns {boolean}
   */
  has(id) {
    return this.#tools.has(id)
  }

  /**
   * 列出所有工具 ID
   *
   * @returns {string[]}
   */
  list() {
    return [...this.#tools.keys()]
  }
}
