# colony-bee-sdk

Colony 系统 Bee 接入 SDK，让 Agent（Bee）能够快速接入 [colony-queen](https://github.com/loongJiu/colony-queen) 协调服务。

## 特性

- 四步握手安全认证（SHA256 + HMAC-SHA256）
- 自动心跳上报与超时重连（指数退避）
- 内嵌 HTTP 服务器，接收 Queen 任务分发
- 任务并发控制与超时管理
- 工具注册与技能系统
- 事件驱动架构

## 安装

```bash
npm install colony-bee-sdk
```

**前置条件：** Node.js >= 18

## 快速开始

### 1. 编写 bee.yaml

```yaml
identity:
  role: worker
  name: my-worker
  description: "我的 Worker Agent"
  tags: [demo]

runtime:
  protocol: http

capabilities:
  - code_generation
  - debugging

model:
  name: glm-4

tools: []
skills: []

constraints:
  max_concurrent: 1
  timeout_default: 30
  queue_max: 100
  retry_max: 3

heartbeat:
  interval: 10
```

### 2. 创建 Agent

```javascript
import { BeeAgent } from 'colony-bee-sdk'

const agent = await BeeAgent.fromSpec('./bee.yaml')

// 注册任务处理器
agent.onTask('code_generation', async (ctx) => {
  ctx.logger.info(`处理任务: ${ctx.taskId}`)

  // 调用模型（需先配置 modelCaller）
  const result = await ctx.callModel('根据需求生成代码')

  return { code: result, language: 'javascript' }
})

agent.onTask('debugging', async (ctx) => {
  return { analysis: `调试完成: ${ctx.input}` }
})

// 监听事件
agent.on('joined', ({ agentId }) => {
  console.log(`已加入 Colony: ${agentId}`)
})

agent.on('disconnected', ({ reason }) => {
  console.log(`断开连接: ${reason}`)
})

// 加入 Colony
await agent.join('http://127.0.0.1:9009', 'your-colony-token')

console.log('Agent 运行中，按 Ctrl+C 退出')
```

### 3. 优雅退出

```javascript
process.on('SIGINT', async () => {
  await agent.leave()
  process.exit(0)
})
```

## API

### BeeAgent

SDK 核心类，继承 EventEmitter。

| 方法 | 说明 |
|---|---|
| `BeeAgent.fromSpec(yamlPath)` | 从 bee.yaml 创建实例（静态方法） |
| `agent.join(queenUrl, colonyToken)` | 加入 Colony，执行握手并启动心跳 |
| `agent.leave()` | 优雅离开 Colony |
| `agent.close()` | 强制关闭所有资源 |
| `agent.onTask(capability, handler)` | 注册任务处理器 |
| `agent.registerTool(id, handlerOrSchema)` | 注册工具 |
| `agent.defineSkill(id, config)` | 定义技能 |
| `agent.setModelCaller(fn)` | 设置模型调用函数 |
| `agent.agentId` | 当前 Agent ID |
| `agent.status` | 当前状态 |

### 事件

| 事件名 | 数据 | 说明 |
|---|---|---|
| `joined` | `{ agentId, sessionToken }` | 成功加入 Colony |
| `disconnected` | `{ reason }` | 断开连接 |
| `reconnected` | `{ agentId }` | 重连成功 |
| `error` | `{ error }` | 发生错误 |

### 任务上下文 (ctx)

`onTask` 回调接收的上下文对象。

| 属性/方法 | 说明 |
|---|---|
| `ctx.taskId` | 任务 ID |
| `ctx.capability` | 能力名称 |
| `ctx.input` | 任务输入 |
| `ctx.signal` | AbortSignal（任务取消信号） |
| `ctx.state` | 共享状态（`get`/`set`） |
| `ctx.logger` | 子日志器 |
| `ctx.tools[id](input)` | 调用注册的工具 |
| `ctx.callModel(prompt, options?)` | 调用模型 |
| `ctx.callModelWithTools(prompt, tools?, options?)` | 带工具调用模型 |
| `ctx.progress(percent, message?)` | 上报进度 |
| `ctx.activateSkill(skillId, input?)` | 激活技能 |

### 模型调用

SDK 不内置 LLM 调用，通过 `setModelCaller` 注入：

```javascript
agent.setModelCaller(async (prompt, options) => {
  const res = await fetch('https://api.example.com/v1/chat/completions', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer xxx' },
    body: JSON.stringify({ model: 'glm-4', messages: [{ role: 'user', content: prompt }] })
  })
  const data = await res.json()
  return data.choices[0].message.content
})
```

## bee.yaml 规范

| 字段 | 类型 | 必填 | 默认值 | 说明 |
|---|---|---|---|---|
| `identity.role` | string | 是 | - | Agent 角色：`worker` 或 `scout` |
| `identity.name` | string | 是 | - | Agent 名称 |
| `identity.description` | string | 否 | `""` | Agent 描述 |
| `identity.tags` | string[] | 否 | `[]` | 标签 |
| `runtime.protocol` | string | 否 | `"http"` | 协议 |
| `capabilities` | string[] | 是 | - | 能力列表 |
| `model.name` | string | 否 | - | 模型名称 |
| `tools[].id` | string | 否 | `[]` | 工具定义 |
| `skills[].id` | string | 否 | `[]` | 技能定义 |
| `constraints.max_concurrent` | number | 否 | `1` | 最大并发任务数 |
| `constraints.timeout_default` | number | 否 | `30` | 默认超时（秒） |
| `constraints.queue_max` | number | 否 | `100` | 最大队列深度 |
| `constraints.retry_max` | number | 否 | `3` | 最大重试次数 |
| `heartbeat.interval` | number | 否 | `10` | 心跳间隔（秒） |

## 协议

SDK 与 colony-queen 之间使用四步握手协议：

1. **Join** — Agent 发送 spec + `SHA256(timestamp + token)` 签名
2. **Challenge** — Queen 返回随机 nonce
3. **Verify** — Agent 发送 `HMAC-SHA256(nonce, token)` 签名
4. **Welcome** — Queen 返回 agent_id + session_token

握手成功后，Agent 自动启动心跳（默认 10 秒），Queen 通过 HTTP 反向调用 Agent 的端点分发任务。

## 测试

```bash
npm test
```

## License

MIT
