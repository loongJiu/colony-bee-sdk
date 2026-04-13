/**
 * Queen API 客户端
 *
 * 封装所有向 Queen 发起的 HTTP 请求
 */

import { ConnectionError, HandshakeError, UnauthorizedError } from '../errors.js'
import { Logger } from '../logger.js'
import type { BeeSpec } from '../spec-loader.js'
import type { JoinResponse, VerifyResponse, HeartbeatPayload } from '../types.js'
import {
  CONTROL_PLANE_CONTRACT,
  CONTROL_PLANE_CONTRACT_VERSION,
  isControlPlaneContractCompatible,
} from '../contracts/control-plane.js'

export class QueenClient {
  readonly #baseUrl: string
  readonly #logger: Logger

  constructor(queenUrl: string, logger: Logger) {
    this.#baseUrl = queenUrl.replace(/\/+$/, '')
    this.#logger = logger.child({ component: 'queen-client' })
  }

  /** 发送 join 请求（握手步骤 1） */
  async join(spec: BeeSpec, timestamp: string, signature: string): Promise<JoinResponse> {
    const data = await this.#post('/colony/join', {
      spec,
      timestamp,
      signature,
      contract: CONTROL_PLANE_CONTRACT,
    })
    if (typeof data !== 'object' || data === null || !('nonce' in data)) {
      throw new HandshakeError('Invalid join response: missing nonce')
    }
    return data as unknown as JoinResponse
  }

  /** 发送 verify 请求（握手步骤 2） */
  async verify(nonce: string, signedNonce: string): Promise<VerifyResponse> {
    const data = await this.#post('/colony/verify', {
      nonce,
      signed_nonce: signedNonce,
      contract_version: CONTROL_PLANE_CONTRACT_VERSION,
    })
    if (typeof data !== 'object' || data === null || !('agent_id' in data) || !('session_token' in data)) {
      throw new HandshakeError('Invalid verify response: missing agent_id or session_token')
    }
    return data as unknown as VerifyResponse
  }

  /** 发送心跳 */
  async heartbeat(sessionToken: string, data: HeartbeatPayload = {}): Promise<Record<string, unknown>> {
    return this.#post('/colony/heartbeat', {
      session_token: sessionToken,
      status: data.status ?? 'idle',
      load: data.load ?? 0,
      active_tasks: data.active_tasks ?? 0,
      queue_depth: data.queue_depth ?? 0,
      contract_version: data.contract_version ?? CONTROL_PLANE_CONTRACT_VERSION,
    })
  }

  /** 更新 Agent spec */
  async updateSpec(sessionToken: string, patch: Record<string, unknown>): Promise<Record<string, unknown>> {
    return this.#post('/colony/update', {
      session_token: sessionToken,
      patch,
      contract_version: CONTROL_PLANE_CONTRACT_VERSION,
    })
  }

  /** 优雅离线 */
  async leave(sessionToken: string): Promise<Record<string, unknown>> {
    return this.#post('/colony/leave', {
      session_token: sessionToken,
      contract_version: CONTROL_PLANE_CONTRACT_VERSION,
    })
  }

  /** 通用 POST 请求 */
  async #post(path: string, body: Record<string, unknown>): Promise<Record<string, unknown>> {
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

      const data = await res.json() as Record<string, unknown>
      if (!res.ok) {
        throw new ConnectionError(
          `${res.status} ${JSON.stringify(data)}`,
          res.status >= 500
        )
      }
      this.#assertContractCompatibility(path, data)

      return data
    } catch (err) {
      if (err instanceof UnauthorizedError || err instanceof ConnectionError) {
        throw err
      }
      const message = err instanceof Error ? err.message : String(err)
      this.#logger.error(`POST ${path} failed: ${message}`)
      throw new ConnectionError(message, true)
    }
  }

  #assertContractCompatibility(path: string, data: Record<string, unknown>): void {
    const contractVersion = typeof data.contract_version === 'string'
      ? data.contract_version
      : CONTROL_PLANE_CONTRACT_VERSION
    if (!isControlPlaneContractCompatible(contractVersion)) {
      throw new ConnectionError(`Incompatible control-plane contract version "${contractVersion}" from ${path}`, false)
    }
  }
}
