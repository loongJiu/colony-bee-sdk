/**
 * 心跳管理器
 *
 * 定时向 Queen 发送心跳，上报负载信息
 */

import { EventEmitter } from 'node:events'
import { QueenClient } from '../transport/queen-client.js'
import { Logger } from '../logger.js'
import type { HeartbeatStats } from '../types.js'

const DEFAULT_INTERVAL_MS = 10_000
const MAX_CONSECUTIVE_FAILURES = 3

export class HeartbeatManager extends EventEmitter {
  readonly #queenClient: QueenClient
  readonly #intervalMs: number
  readonly #logger: Logger
  #timer: ReturnType<typeof setInterval> | null = null
  #sessionToken: string | null = null
  #getStats: (() => HeartbeatStats) | null = null
  #consecutiveFailures = 0

  constructor(queenClient: QueenClient, options: { intervalMs?: number } = {}, logger: Logger) {
    super()
    this.#queenClient = queenClient
    this.#intervalMs = options.intervalMs ?? DEFAULT_INTERVAL_MS
    this.#logger = logger.child({ component: 'heartbeat' })
  }

  /** 启动心跳 */
  start(sessionToken: string, getStats: () => HeartbeatStats): void {
    this.#sessionToken = sessionToken
    this.#getStats = getStats
    this.#consecutiveFailures = 0
    this.#logger.info(`Heartbeat started (interval: ${this.#intervalMs}ms)`)

    this.#sendOnce()

    this.#timer = setInterval(() => {
      this.#sendOnce()
    }, this.#intervalMs)
  }

  /** 停止心跳 */
  stop(): void {
    if (this.#timer) {
      clearInterval(this.#timer)
      this.#timer = null
      this.#logger.info('Heartbeat stopped')
    }
    this.#sessionToken = null
  }

  /** 发送一次心跳 */
  async #sendOnce(): Promise<void> {
    if (!this.#sessionToken || !this.#getStats) return

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
      const message = err instanceof Error ? err.message : String(err)
      this.#logger.warn(`Heartbeat failed (${this.#consecutiveFailures}/${MAX_CONSECUTIVE_FAILURES}): ${message}`)

      if (this.#consecutiveFailures >= MAX_CONSECUTIVE_FAILURES) {
        this.#logger.error('Max consecutive heartbeat failures reached')
        this.emit('disconnected', { reason: 'heartbeat_failures' })
      }
    }
  }
}
