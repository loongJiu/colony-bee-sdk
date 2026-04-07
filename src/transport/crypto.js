/**
 * 加密工具
 *
 * 用于 Colony 握手协议中的身份验证：
 * - join 阶段：SHA256(timestamp + token)
 * - verify 阶段：HMAC-SHA256(nonce, token)
 *
 * 与 colony-queen/src/utils/crypto.js 完全对应
 */

import { createHash, createHmac } from 'node:crypto'

/**
 * 生成 join 签名
 *
 * @param {string} timestamp - ISO 8601 时间戳
 * @param {string} token - 共享密钥 COLONY_TOKEN
 * @returns {string} SHA256 hex 签名
 */
export function signJoin(timestamp, token) {
  return createHash('sha256')
    .update(timestamp + token)
    .digest('hex')
}

/**
 * 生成 verify 签名
 *
 * @param {string} nonce - Queen 发出的 nonce
 * @param {string} token - 共享密钥 COLONY_TOKEN
 * @returns {string} HMAC-SHA256 hex 签名
 */
export function signNonce(nonce, token) {
  return createHmac('sha256', token)
    .update(nonce)
    .digest('hex')
}
