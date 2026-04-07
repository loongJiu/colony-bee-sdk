/**
 * 共享状态 KV 存储
 *
 * 基于 Map，用于任务间共享状态
 */

export class SharedState {
  /** @type {Map<string, any>} */
  #data = new Map()

  /**
   * @param {Object} [initialData] - 初始数据
   */
  constructor(initialData) {
    if (initialData && typeof initialData === 'object') {
      for (const [key, value] of Object.entries(initialData)) {
        this.#data.set(key, value)
      }
    }
  }

  /**
   * @param {string} key
   * @returns {any}
   */
  get(key) {
    return this.#data.get(key)
  }

  /**
   * @param {string} key
   * @param {*} value
   */
  set(key, value) {
    this.#data.set(key, value)
  }

  /**
   * @param {string} key
   * @returns {boolean}
   */
  delete(key) {
    return this.#data.delete(key)
  }

  /**
   * @returns {Object}
   */
  toJSON() {
    return Object.fromEntries(this.#data)
  }
}
