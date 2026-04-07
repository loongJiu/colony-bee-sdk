/**
 * Queen API 客户端
 *
 * 封装所有向 Queen 发起的 HTTP 请求
 */

import { ConnectionError, UnauthorizedError } from '../errors.js'

export class QueenClient {
  /** @type {string} */
  #baseUrl
  /** @type {import('../logger.js').Logger} */
  #logger

  /**
   * @param {string} queenUrl - Queen 服务地址（如 http://127.0.0.1:9009）
   * @param {import('../logger.js').Logger} logger
   */
  constructor(queenUrl, logger) {
    this.#baseUrl = queenUrl.replace(/\/+$/, '')
    this.#logger = logger.child({ component: 'queen-client' })
  }

  /**
   * 发送 join 请求（握手步骤 1）
   *
   * @param {Object} spec - Agent spec
   * @param {string} timestamp - ISO 时间戳
   * @param {string} signature - SHA256 签名
   * @returns {Promise<{nonce: string, expiresAt: string}>}
   */
  async join(spec, timestamp, signature) {
    return this.#post('/colony/join', { spec, timestamp, signature })
  }

  /**
   * 发送 verify 请求（握手步骤 2）
   *
   * @param {string} nonce
   * @param {string} signedNonce
   * @returns {Promise<{agent_id: string, session_token: string, queen_id: string, colony_version: string, joined_at: string}>}
   */
  async verify(nonce, signedNonce) {
    return this.#post('/colony/verify', { nonce, signed_nonce: signedNonce })
  }

  /**
   * 发送心跳
   *
   * @param {string} sessionToken
   * @param {{status?: string, load?: number, active_tasks?: number, queue_depth?: number}} data
   * @returns {Promise<Object>}
   */
  async heartbeat(sessionToken, data = {}) {
    return this.#post('/colony/heartbeat', {
      session_token: sessionToken,
      status: data.status ?? 'idle',
      load: data.load ?? 0,
      active_tasks: data.active_tasks ?? 0,
      queue_depth: data.queue_depth ?? 0
    })
  }

  /**
   * 更新 Agent spec
   *
   * @param {string} sessionToken
   * @param {Object} patch
   * @returns {Promise<Object>}
   */
  async updateSpec(sessionToken, patch) {
    return this.#post('/colony/update', { session_token: sessionToken, patch })
  }

  /**
   * 优雅离线
   *
   * @param {string} sessionToken
   * @returns {Promise<Object>}
   */
  async leave(sessionToken) {
    return this.#post('/colony/leave', { session_token: sessionToken })
  }

  /**
   * 通用 POST 请求
   *
   * @param {string} path
   * @param {Object} body
   * @returns {Promise<Object>}
   */
  async #post(path, body) {
    const url = `${this.#baseUrl}${path}`
    try {
      const res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body)
      })

      if (res.status === 401) {
        throw new UnauthorizedError(`Unauthorized: ${path}`)
      }

      const data = await res.json()
      if (!res.ok) {
        throw new ConnectionError(
          `${res.status} ${JSON.stringify(data)}`,
          res.status >= 500
        )
      }

      return data
    } catch (err) {
      if (err instanceof UnauthorizedError || err instanceof ConnectionError) {
        throw err
      }
      this.#logger.error(`POST ${path} failed: ${err.message}`)
      throw new ConnectionError(err.message, true)
    }
  }
}
