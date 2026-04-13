#!/usr/bin/env node

/**
 * Harness Adapter 示例
 *
 * 展示 harness 如何通过 adapter 复用 colony-bee-sdk 接入 Queen。
 *
 * 用法：
 *   QUEEN_URL=http://127.0.0.1:9009 COLONY_TOKEN=change-me node examples/harness-adapter.mjs
 */

import { BeeAgent } from '../src/index.ts'

const QUEEN_URL = process.env.QUEEN_URL || 'http://127.0.0.1:9009'
const COLONY_TOKEN = process.env.COLONY_TOKEN || 'change-me'

/** 假设这是你已有的 harness runtime（可替换为真实实现） */
class DemoHarnessRuntime {
  async runTask(input, trace) {
    return {
      harness: 'demo-runtime',
      trace,
      answer: `Harness handled: ${JSON.stringify(input)}`
    }
  }
}

/** 适配器：把 harness 任务入口映射到 BeeAgent capability */
class HarnessToBeeAdapter {
  constructor(harnessRuntime) {
    this.harnessRuntime = harnessRuntime
  }

  bind(agent, capability = 'harness_task') {
    agent.onTask(capability, async (ctx) => {
      const trace = {
        requestId: ctx.logger ? 'see-log-bindings' : 'unknown',
        taskId: ctx.taskId,
      }
      return await this.harnessRuntime.runTask(ctx.input, trace)
    })
  }
}

async function main() {
  const agent = await BeeAgent.fromSpec('./bee.yaml')
  const harnessRuntime = new DemoHarnessRuntime()
  const adapter = new HarnessToBeeAdapter(harnessRuntime)

  adapter.bind(agent, 'code_generation')

  await agent.join(QUEEN_URL, COLONY_TOKEN)
  console.log('Harness adapter is running. Press Ctrl+C to stop.')

  const shutdown = async () => {
    await agent.leave()
    process.exit(0)
  }
  process.on('SIGINT', shutdown)
  process.on('SIGTERM', shutdown)
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
