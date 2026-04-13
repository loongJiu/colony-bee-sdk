/**
 * 加密工具
 *
 * 用于 Colony 握手协议中的身份验证：
 * - join 阶段：SHA256(timestamp + token)
 * - verify 阶段：HMAC-SHA256(nonce, token)
 */

import { createHmac } from 'node:crypto'

/** 生成 join 签名（HMAC-SHA256，避免长度扩展攻击） */
export function signJoin(timestamp: string, token: string): string {
  return createHmac('sha256', token)
    .update(timestamp)
    .digest('hex')
}

/** 生成 verify 签名 */
export function signNonce(nonce: string, token: string): string {
  return createHmac('sha256', token)
    .update(nonce)
    .digest('hex')
}
