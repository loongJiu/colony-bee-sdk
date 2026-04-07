/**
 * 心跳管理器
 *
 * 定时向 Queen 发送心跳，上报负载信息
 */

import { EventEmitter } from 'node:events'

const DEFAULT_INTERVAL_MS = 10_000
const MAX_CONSECUTIVE_FAILURES = 3

export class HeartbeatManager extends EventEmitter {
  /** @type {import('../transport/queen-client.js').QueenClient} */
  #queenClient
  /** @type {number} */
  #intervalMs
  /** @type {import('../logger.js').Logger} */
  #logger
  /** @type {NodeJS.Timeout|null} */
  #timer = null
  /** @type {string|null} */
  #sessionToken = null
  /** @type {() => {activeTasks: number, queueDepth: number, load: number}} */
  #getStats
  /** @type {number} */
  #consecutiveFailures = 0

  /**
   * @param {import('../transport/queen-client.js').QueenClient} queenClient
   * @param {{intervalMs?: number}} [options]
   * @param {import('../logger.js').Logger} logger
   */
  constructor(queenClient, options = {}, logger) {
    super()
    this.#queenClient = queenClient
    this.#intervalMs = options.intervalMs ?? DEFAULT_INTERVAL_MS
    this.#logger = logger.child({ component: 'heartbeat' })
  }

  /**
   * 启动心跳
   *
   * @param {string} sessionToken
   * @param {() => {activeTasks: number, queueDepth: number, load: number}} getStats
   */
  start(sessionToken, getStats) {
    this.#sessionToken = sessionToken
    this.#getStats = getStats
    this.#consecutiveFailures = 0
    this.#logger.info(`Heartbeat started (interval: ${this.#intervalMs}ms)`)

    // 立即发送一次
    this.#sendOnce()

    this.#timer = setInterval(() => {
      this.#sendOnce()
    }, this.#intervalMs)
  }

  /**
   * 停止心跳
   */
  stop() {
    if (this.#timer) {
      clearInterval(this.#timer)
      this.#timer = null
      this.#logger.info('Heartbeat stopped')
    }
    this.#sessionToken = null
  }

  /**
   * 发送一次心跳
   */
  async #sendOnce() {
    if (!this.#sessionToken) return

    const stats = this.#getStats()
    try {
      await this.#queenClient.heartbeat(this.#sessionToken, {
        status: stats.activeTasks > 0 ? 'busy' : 'idle',
        load: stats.load,
        active_tasks: stats.activeTasks,
        queue_depth: stats.queueDepth
      })
      this.#consecutiveFailures = 0
    } catch (err) {
      this.#consecutiveFailures++
      this.#logger.warn(`Heartbeat failed (${this.#consecutiveFailures}/${MAX_CONSECUTIVE_FAILURES}): ${err.message}`)

      if (this.#consecutiveFailures >= MAX_CONSECUTIVE_FAILURES) {
        this.#logger.error('Max consecutive heartbeat failures reached')
        this.emit('disconnected', { reason: 'heartbeat_failures' })
      }
    }
  }
}
