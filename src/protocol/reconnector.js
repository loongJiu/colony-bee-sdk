/**
 * 自动重连
 *
 * 指数退避策略重连 Queen
 */

import { EventEmitter } from 'node:events'

const DEFAULT_BASE_DELAY_MS = 1000
const DEFAULT_MAX_DELAY_MS = 30_000
const JITTER_RANGE = 0.2

export class Reconnector extends EventEmitter {
  /** @type {number} */
  #baseDelayMs
  /** @type {number} */
  #maxDelayMs
  /** @type {import('../logger.js').Logger} */
  #logger
  /** @type {number} */
  #attempt = 0
  /** @type {boolean} */
  #stopped = false

  /**
   * @param {{baseDelayMs?: number, maxDelayMs?: number}} [options]
   * @param {import('../logger.js').Logger} logger
   */
  constructor(options = {}, logger) {
    super()
    this.#baseDelayMs = options.baseDelayMs ?? DEFAULT_BASE_DELAY_MS
    this.#maxDelayMs = options.maxDelayMs ?? DEFAULT_MAX_DELAY_MS
    this.#logger = logger.child({ component: 'reconnector' })
  }

  /**
   * 尝试重连
   *
   * @param {import('./handshake.js').Handshake} handshake
   * @param {Object} spec
   * @param {string} colonyToken
   * @returns {Promise<{agentId: string, sessionToken: string}>}
   */
  async reconnect(handshake, spec, colonyToken) {
    this.#stopped = false

    while (!this.#stopped) {
      const delay = this.#calcDelay()
      this.#attempt++
      this.#logger.info(`Reconnect attempt #${this.#attempt}, waiting ${Math.round(delay)}ms`)

      await this.#sleep(delay)

      if (this.#stopped) break

      try {
        const result = await handshake.execute(spec, colonyToken)
        this.#logger.info(`Reconnected successfully: agent_id=${result.agentId}`)
        this.reset()
        this.emit('reconnected', result)
        return result
      } catch (err) {
        this.#logger.warn(`Reconnect attempt #${this.#attempt} failed: ${err.message}`)
      }
    }

    throw new Error('Reconnector stopped')
  }

  /**
   * 重置退避计数
   */
  reset() {
    this.#attempt = 0
  }

  /**
   * 停止重连
   */
  stop() {
    this.#stopped = true
  }

  /**
   * 计算退避延迟
   *
   * @returns {number} 延迟毫秒数
   */
  #calcDelay() {
    const base = Math.min(this.#baseDelayMs * Math.pow(2, this.#attempt), this.#maxDelayMs)
    const jitter = base * JITTER_RANGE * Math.random()
    return base + jitter
  }

  /**
   * @param {number} ms
   * @returns {Promise<void>}
   */
  #sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms))
  }
}
