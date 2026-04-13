<h1 align="center">colony-bee-sdk</h1>

<p align="center">
  <strong>Colony Bee Agent SDK</strong> — 快速接入 <a href="https://github.com/loongJiu/colony-queen">colony-queen</a> 编排服务
</p>

<p align="center">
  <img src="https://img.shields.io/badge/node-%3E%3D18-339933?logo=node.js&logoColor=white" alt="Node.js >= 18" />
  <img src="https://img.shields.io/badge/TypeScript-6.0-3178C6?logo=typescript&logoColor=white" alt="TypeScript" />
  <img src="https://img.shields.io/badge/license-MIT-blue" alt="MIT License" />
  <img src="https://img.shields.io/badge/ESM-✓-yellow" alt="ESM" />
  <img src="https://img.shields.io/badge/CJS-✓-orange" alt="CJS" />
</p>

---

## 特性

- **安全认证** — 四步握手协议（HMAC-SHA256）+ HTTP 端点认证（Bearer / 请求级 HMAC 签名）
- **自动重连** — 心跳上报 + 指数退避重连
- **任务管理** — 并发控制、优先级队列、超时管理
- **工具系统** — Zod Schema 驱动的工具注册，自动生成 LLM 兼容的 JSON Schema
- **模型集成** — `callModelWithTools` 单轮工具调用解析，支持流式输出
- **结构化结果** — 泛型 `onTask<TInput, TOutput>` + 自动元数据收集
- **模型无关** — 通过 `setModelCaller` / `setStreamingModelCaller` 注入任意 LLM
- **环境变量插值** — bee.yaml 支持 `${VAR}` 和 `${VAR:-default}` 语法
- **契约版本治理** — 控制面契约版本固定与兼容校验（发布前契约回归）
- **灵活部署** — 支持 bee.yaml 声明式配置或纯环境变量构建（`fromEnv()`）
- **开发模式** — `devMode` 开启详细日志、禁用重连，快速定位问题
- **事件驱动** — 基于 EventEmitter 的生命周期管理
- **双格式输出** — 同时支持 ESM 和 CommonJS

## 安装

```bash
npm install colony-bee-sdk
```

> **前置条件：** Node.js >= 18

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
  queue_strategy: fifo
  retry_max: 3

heartbeat:
  interval: 10
```

### 2. 创建 Agent

```javascript
import { BeeAgent } from 'colony-bee-sdk'
import { z } from 'zod'

const agent = await BeeAgent.fromSpec('./bee.yaml')

// 设置模型调用函数
agent.setModelCaller(async (prompt, options) => {
  const res = await fetch('https://api.example.com/v1/chat/completions', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer xxx' },
    body: JSON.stringify({ model: 'glm-4', messages: [{ role: 'user', content: prompt }] })
  })
  const data = await res.json()
  return data.choices[0].message.content
})

// 注册带 Schema 的工具
agent.registerTool('search', {
  description: '搜索互联网获取最新信息',
  inputSchema: z.object({
    query: z.string().describe('搜索关键词'),
    maxResults: z.number().optional().default(5),
  }),
  outputSchema: z.object({
    results: z.array(z.object({ title: z.string(), url: z.string() })),
  }),
  execute: async ({ query, maxResults }) => {
    return { results: await searchWeb(query, maxResults) }
  },
})

// 注册泛型任务处理器
agent.onTask<{ prompt: string }, { code: string }>('code_generation', async (ctx) => {
  ctx.input.prompt // TypeScript 类型推断为 string

  const response = await ctx.callModelWithTools('生成代码', ['search'])
  return {
    data: { code: response.content },
    summary: `已生成代码，使用了 ${response.toolCalls?.length ?? 0} 次工具`,
  }
})

// 监听事件
agent.on('joined', ({ agentId }) => console.log(`已加入 Colony: ${agentId}`))
agent.on('disconnected', ({ reason }) => console.log(`断开连接: ${reason}`))

// 加入 Colony
await agent.join('http://127.0.0.1:9009', 'your-colony-token')
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

SDK 核心类，继承 `EventEmitter`。

#### 工厂方法

| 方法 | 说明 |
|---|---|
| `BeeAgent.fromSpec(path, options?)` | 从 bee.yaml 创建实例 |
| `BeeAgent.fromEnv()` | 从环境变量创建实例（容器化部署） |

#### 注册

| 方法 | 说明 |
|---|---|
| `agent.onTask<TInput, TOutput>(capability, handler)` | 注册泛型任务处理器 |
| `agent.registerTool(id, handlerOrDef)` | 注册工具（函数简写 / Zod Schema 定义） |
| `agent.defineSkill(id, config)` | 定义技能 |
| `agent.setModelCaller(fn)` | 设置模型调用函数 |
| `agent.setStreamingModelCaller(fn)` | 设置流式模型调用函数 |
| `agent.getToolSchemas()` | 获取所有工具的 JSON Schema |

#### 生命周期

| 方法 / 属性 | 说明 |
|---|---|
| `agent.join(queenUrl, token)` | 加入 Colony |
| `agent.leave()` | 优雅离开 Colony |
| `agent.close()` | 强制关闭所有资源 |
| `agent.agentId` | 当前 Agent ID |
| `agent.status` | 当前状态 |

#### 事件

| 事件 | 数据 | 说明 |
|---|---|---|
| `joined` | `{ agentId, sessionToken }` | 成功加入 Colony |
| `disconnected` | `{ reason }` | 断开连接 |
| `reconnected` | `{ agentId }` | 重连成功 |

### 任务上下文 (TaskContext)

`onTask` 回调接收的 `ctx` 对象：

| 属性 / 方法 | 说明 |
|---|---|
| `ctx.taskId` | 任务 ID |
| `ctx.capability` | 能力名称 |
| `ctx.input` | 任务输入（泛型 `TInput`） |
| `ctx.signal` | AbortSignal（任务取消信号） |
| `ctx.state` | 共享状态（`get` / `set`） |
| `ctx.logger` | 子日志器 |
| `ctx.tools[id](input)` | 调用注册的工具 |
| `ctx.callModel(prompt, opts?)` | 调用模型 |
| `ctx.callModelWithTools(prompt, tools?, opts?)` | 带工具调用模型（返回 `ModelResponse`） |
| `ctx.streamModel(prompt, onChunk, opts?)` | 流式模型调用 |
| `ctx.progress(percent, msg?)` | 上报进度 |
| `ctx.activateSkill(skillId, input?)` | 激活技能 |
| `ctx.getMetadata()` | 获取元数据（`toolsInvoked`, `iterationsCount`, `tokenUsage`） |

### 工具系统

支持两种注册方式，向后兼容：

```javascript
// 简写：纯函数
agent.registerTool('calc', (input) => input.a + input.b)

// 完整定义：带 Zod Schema
agent.registerTool('search', {
  description: '搜索互联网',
  inputSchema: z.object({
    query: z.string().describe('搜索关键词'),
  }),
  execute: async ({ query }) => ({ results: [] }),
})
```

`getToolSchemas()` 返回兼容 OpenAI function calling / Anthropic tool use 格式的 JSON Schema：

```javascript
agent.getToolSchemas()
// [{ name: 'search', description: '搜索互联网', parameters: { type: 'object', properties: { query: { type: 'string' } }, required: ['query'] } }]
```

### 模型调用

SDK 不内置 LLM 调用，通过注入函数对接任意模型后端：

```javascript
// 普通调用
agent.setModelCaller(async (prompt, options) => {
  // options 可能包含 tools（ToolSchema 数组）
  return await callLLM(prompt, options)
})

// 流式调用
agent.setStreamingModelCaller(async (prompt, options, onChunk) => {
  const stream = await callLLMStream(prompt, options)
  for await (const chunk of stream) {
    onChunk(chunk.text)
  }
  return { content: fullText, usage, stopReason: 'end_turn' }
})
```

`callModelWithTools` 执行单轮工具调用：解析工具 Schema → 调用模型 → 执行工具 → 返回 `ModelResponse`。

### 结构化任务结果

任务处理器可返回普通值或 `StructuredTaskResult<T>`：

```javascript
agent.onTask<{ topic: string }, { article: string }>('writing', async (ctx) => {
  const article = await ctx.callModel(ctx.input.topic)
  return {
    data: { article },
    summary: `已生成 ${article.length} 字文章`,
  }
})
```

`ctx.getMetadata()` 自动追踪工具调用、模型迭代次数和 token 消耗。

### 环境变量构建

无需 bee.yaml，适用于容器化部署：

```javascript
const agent = BeeAgent.fromEnv()
// 读取环境变量：BEE_ROLE, BEE_NAME, BEE_CAPABILITIES（逗号分隔）
// BEE_MAX_CONCURRENT, BEE_TIMEOUT, BEE_QUEUE_MAX
// 可选安全变量：BEE_ENDPOINT_AUTH_TYPE, BEE_ENDPOINT_AUTH_SECRET, BEE_ALLOW_INSECURE_ENDPOINT
```

### 开发模式

```javascript
const agent = await BeeAgent.fromSpec('./bee.yaml', {
  devMode: process.env.NODE_ENV === 'development',
})
// devMode 开启后：
// - 日志级别设为 debug
// - 打印任务完整输入/输出和工具调用详情
// - 禁用自动重连（失败立即暴露问题）
```

### 自定义日志

注入任意兼容日志器（pino / winston 等）：

```javascript
const agent = await BeeAgent.fromSpec('./bee.yaml', {
  logger: pinoLogger, // 只需实现 debug / info / warn / error
})
```

## bee.yaml 规范

| 字段 | 类型 | 必填 | 默认值 | 说明 |
|---|---|---|---|---|
| `identity.role` | `string` | 是 | - | 角色：`worker` / `scout` |
| `identity.name` | `string` | 是 | - | Agent 名称，支持 `${VAR}` 插值 |
| `identity.description` | `string` | 否 | `""` | Agent 描述 |
| `identity.tags` | `string[]` | 否 | `[]` | 标签 |
| `runtime.protocol` | `string` | 否 | `"http"` | 协议 |
| `runtime.health_check.enabled` | `boolean` | 否 | `false` | 启用独立健康检查端口 |
| `runtime.health_check.port` | `number` | 否 | `9010` | 健康检查端口 |
| `runtime.health_check.path` | `string` | 否 | `"/health"` | 健康检查路径 |
| `capabilities` | `string[]` | 是 | - | 能力列表 |
| `model.name` | `string` | 否 | - | 模型名称，支持 `${VAR:-default}` |
| `tools[].id` | `string` | 否 | `[]` | 工具定义 |
| `skills[].id` | `string` | 否 | `[]` | 技能定义 |
| `constraints.max_concurrent` | `number` | 否 | `1` | 最大并发任务数 |
| `constraints.timeout_default` | `number` | 否 | `30` | 默认超时（秒） |
| `constraints.queue_max` | `number` | 否 | `100` | 最大队列深度 |
| `constraints.queue_strategy` | `string` | 否 | `"fifo"` | 队列策略：`fifo` / `priority` |
| `constraints.retry_max` | `number` | 否 | `3` | 最大重试次数 |
| `security.endpoint_auth.type` | `string` | 否 | - | 认证类型：`bearer` / `hmac` |
| `security.endpoint_auth.secret` | `string` | 否 | - | 认证密钥，支持 `${VAR}` 插值 |
| `security.endpoint_auth.hmac.max_skew_seconds` | `number` | 否 | `300` | HMAC 时间窗（秒） |
| `security.endpoint_auth.hmac.nonce_ttl_seconds` | `number` | 否 | `300` | nonce 防重放 TTL（秒） |
| `security.allow_insecure_endpoint` | `boolean` | 否 | `false` | 生产环境是否允许未认证端点（仅建议临时调试） |
| `heartbeat.interval` | `number` | 否 | `10` | 心跳间隔（秒） |

### 环境变量插值

所有字符串值支持 `${VAR}` 和 `${VAR:-default}` 语法：

```yaml
identity:
  name: ${BEE_NAME}
  description: ${BEE_DESCRIPTION:-Default Agent}

model:
  name: ${MODEL_NAME:-gpt-4o}

security:
  endpoint_auth:
    type: bearer
    secret: ${ENDPOINT_SECRET}
```

### 端点认证与安全基线

- `bearer`：适合内网、可信网络、或已在网关层做强认证的场景。
- `hmac`：适合公网入口，SDK 按请求校验签名，默认包含时间窗和 nonce 防重放。
- 生产环境默认要求 `endpoint_auth`；若确需临时放开，必须显式设置 `security.allow_insecure_endpoint: true`（或环境变量 `BEE_ALLOW_INSECURE_ENDPOINT=true`）。
- 推荐部署拓扑：`Client -> API Gateway(mTLS/WAF/rate limit) -> Bee endpoint`。SDK 保持轻量，mTLS 和流量治理由网关承接。

HMAC 签名头规范：

- `Authorization: HMAC <signature>`
- `X-Bee-Timestamp: <unix-seconds | unix-ms | ISO8601>`
- `X-Bee-Nonce: <unique-request-id>`

canonical string：

```text
METHOD
/request/path
sha256(body)
timestamp
nonce
```

## 握手协议

Agent 与 colony-queen 之间的四步握手：

```
Agent                          Queen
  │                               │
  │─── Join (spec + HMAC-SHA256) ─>│
  │<── Challenge (nonce) ─────────│
  │─── Verify (HMAC-SHA256) ────>│
  │<── Welcome (agent_id) ───────│
  │                               │
  │═══ Heartbeat (interval) ════>│
  │<══ Task Dispatch (HTTP) ═════│
```

1. **Join** — Agent 发送 spec + `HMAC-SHA256(timestamp, token)` 签名
2. **Challenge** — Queen 返回随机 nonce
3. **Verify** — Agent 发送 `HMAC-SHA256(nonce, token)` 签名
4. **Welcome** — Queen 返回 `agent_id` + `session_token`

握手成功后，Agent 自动启动心跳，Queen 通过 HTTP 反向调用 Agent 端点分发任务。

## 控制面契约与兼容矩阵

- 当前契约版本：`1.0.0`（SDK 运行时会校验 `contract_version`）
- 兼容规则与字段治理：[`docs/control-plane-contract.md`](./docs/control-plane-contract.md)
- Queen x SDK 兼容矩阵：[`docs/compatibility-matrix.md`](./docs/compatibility-matrix.md)

发布前可执行契约回归门禁：

```bash
npm run test:contracts
```

## 健康检查与接入路径

- `runtime.health_check.path` 已支持自定义（例如 `/healthz`）
- 健康状态返回分级语义：`healthy / degraded / unhealthy`
- 同时返回 readiness：`ready / not_ready`
- 集成 runbook（含两条接入路径）：[`docs/integration-runbook.md`](./docs/integration-runbook.md)

## 测试

```bash
npm test
```

## License

[MIT](./LICENSE)
