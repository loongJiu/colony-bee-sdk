#!/usr/bin/env node

/**
 * Simple Agent 示例
 *
 * 最简使用方式，展示如何用 colony-bee-sdk 接入 colony-queen
 *
 * 用法：
 *   QUEEN_URL=http://127.0.0.1:9009 COLONY_TOKEN=change-me-in-production node examples/simple-agent.mjs
 */

import { BeeAgent } from '../src/index.js'

const QUEEN_URL = process.env.QUEEN_URL || 'http://127.0.0.1:9009'
const COLONY_TOKEN = process.env.COLONY_TOKEN || 'change-me-in-production'

async function main() {
  // 1. 从 bee.yaml 创建 Agent
  const agent = await BeeAgent.fromSpec('./bee.yaml')

  // 2. 注册任务处理器
  agent.onTask('code_generation', async (ctx) => {
    ctx.logger.info(`Received task: ${ctx.taskId}`)
    ctx.logger.info(`Input: ${JSON.stringify(ctx.input)}`)

    // 模拟处理
    await new Promise(resolve => setTimeout(resolve, 500))

    return {
      result: `Generated code for: ${ctx.input}`,
      agent: 'my-worker'
    }
  })

  agent.onTask('debugging', async (ctx) => {
    ctx.logger.info(`Debugging task: ${ctx.taskId}`)
    return {
      result: `Debug analysis for: ${ctx.input}`,
      agent: 'my-worker'
    }
  })

  // 3. 监听事件
  agent.on('joined', ({ agentId }) => {
    console.log(`✓ Joined Colony as ${agentId}`)
  })

  agent.on('disconnected', ({ reason }) => {
    console.log(`✗ Disconnected: ${reason}`)
  })

  agent.on('reconnected', ({ agentId }) => {
    console.log(`↻ Reconnected as ${agentId}`)
  })

  // 4. 加入 Colony
  try {
    const { agentId } = await agent.join(QUEEN_URL, COLONY_TOKEN)
    console.log(`Agent ${agentId} is running. Press Ctrl+C to stop.`)
  } catch (err) {
    console.error(`Failed to join: ${err.message}`)
    process.exit(1)
  }

  // 5. 优雅退出
  const shutdown = async () => {
    console.log('\nShutting down...')
    await agent.leave()
    console.log('Goodbye!')
    process.exit(0)
  }

  process.on('SIGINT', shutdown)
  process.on('SIGTERM', shutdown)
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
