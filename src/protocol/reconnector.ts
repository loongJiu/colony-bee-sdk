/**
 * 自动重连
 *
 * 指数退避策略重连 Queen
 */

import { EventEmitter } from 'node:events'
import { Logger } from '../logger.js'
import { Handshake } from './handshake.js'
import type { BeeSpec } from '../spec-loader.js'

const DEFAULT_BASE_DELAY_MS = 1000
const DEFAULT_MAX_DELAY_MS = 30_000
const JITTER_RANGE = 0.2

export class Reconnector extends EventEmitter {
  readonly #baseDelayMs: number
  readonly #maxDelayMs: number
  readonly #logger: Logger
  #attempt = 0
  #stopped = false

  constructor(options: { baseDelayMs?: number; maxDelayMs?: number } = {}, logger: Logger) {
    super()
    this.#baseDelayMs = options.baseDelayMs ?? DEFAULT_BASE_DELAY_MS
    this.#maxDelayMs = options.maxDelayMs ?? DEFAULT_MAX_DELAY_MS
    this.#logger = logger.child({ component: 'reconnector' })
  }

  /** 尝试重连 */
  async reconnect(handshake: Handshake, spec: BeeSpec, colonyToken: string): Promise<{ agentId: string; sessionToken: string }> {
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
        const message = err instanceof Error ? err.message : String(err)
        this.#logger.warn(`Reconnect attempt #${this.#attempt} failed: ${message}`)
      }
    }

    throw new Error('Reconnector stopped')
  }

  /** 重置退避计数 */
  reset(): void {
    this.#attempt = 0
  }

  /** 停止重连 */
  stop(): void {
    this.#stopped = true
  }

  #calcDelay(): number {
    const base = Math.min(this.#baseDelayMs * Math.pow(2, this.#attempt), this.#maxDelayMs)
    const jitter = base * JITTER_RANGE * Math.random()
    return base + jitter
  }

  #sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms))
  }
}
