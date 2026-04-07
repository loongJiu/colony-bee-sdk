/**
 * 四步握手协议
 *
 * 编排 join → challenge → verify → welcome 流程
 */

import { signJoin, signNonce } from '../transport/crypto.js'
import { HandshakeError } from '../errors.js'

export class Handshake {
  /** @type {import('../transport/queen-client.js').QueenClient} */
  #queenClient
  /** @type {import('../logger.js').Logger} */
  #logger

  /**
   * @param {import('../transport/queen-client.js').QueenClient} queenClient
   * @param {import('../logger.js').Logger} logger
   */
  constructor(queenClient, logger) {
    this.#queenClient = queenClient
    this.#logger = logger.child({ component: 'handshake' })
  }

  /**
   * 执行四步握手
   *
   * @param {Object} spec - Agent spec
   * @param {string} colonyToken - 共享密钥
   * @returns {Promise<{agentId: string, sessionToken: string}>}
   * @throws {HandshakeError}
   */
  async execute(spec, colonyToken) {
    // Step 1: join
    const timestamp = new Date().toISOString()
    const signature = signJoin(timestamp, colonyToken)

    this.#logger.info('Sending join request')
    let challenge
    try {
      challenge = await this.#queenClient.join(spec, timestamp, signature)
    } catch (err) {
      throw new HandshakeError(`Join failed: ${err.message}`)
    }

    if (!challenge.nonce) {
      throw new HandshakeError('Invalid challenge: missing nonce')
    }

    // Step 2: verify
    const signedNonceValue = signNonce(challenge.nonce, colonyToken)
    this.#logger.info('Sending verify request')

    let welcome
    try {
      welcome = await this.#queenClient.verify(challenge.nonce, signedNonceValue)
    } catch (err) {
      throw new HandshakeError(`Verify failed: ${err.message}`)
    }

    if (!welcome.agent_id || !welcome.session_token) {
      throw new HandshakeError('Invalid welcome: missing agent_id or session_token')
    }

    this.#logger.info(`Handshake completed: agent_id=${welcome.agent_id}`)
    return {
      agentId: welcome.agent_id,
      sessionToken: welcome.session_token
    }
  }
}
